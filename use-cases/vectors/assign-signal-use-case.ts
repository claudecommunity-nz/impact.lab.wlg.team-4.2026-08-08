import { z } from "zod";
import {
  CONFIDENCE_KEY,
  MEMBER_OF,
  VERIFIED_KEY,
  VERIFIED_TRUE_VALUES,
  type Verification,
} from "@/db/vocabulary";
import { type Annotation } from "@/repositories/annotations/annotation-schema";
import { type Signal } from "@/repositories/signals/signal-schema";
import { getAnnotationsForNodesUseCase } from "@/use-cases/annotations/get-annotations-for-nodes-use-case";
import { createEdgeUseCase } from "@/use-cases/edges/create-edge-use-case";
import { createGroupUseCase } from "@/use-cases/groups/create-group-use-case";
import { getActiveGroupsUseCase } from "@/use-cases/groups/get-active-groups-use-case";
import { updateGroupUseCase } from "@/use-cases/groups/update-group-use-case";
import { getSignalsByIdsUseCase } from "@/use-cases/signals/get-signals-by-ids-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { formatDistance, formatDuration, haversineMetres } from "@/utilities/geo";
import { cosineSimilarity, meanVector, runningCentroid } from "@/utilities/vector";

/**
 * The grouping verb: place ONE signal in a level-1 bubble, or start a new one.
 *
 * Order matters — GATES FIRST, similarity second:
 *   1. time: only bubbles alive within the similarity window are candidates;
 *   2. geo: a HARD 1.5km gate whenever BOTH sides have coordinates. Semantic
 *      closeness must never overcome geographic separation — "flooding in Aro
 *      Valley" and "flooding in Petone" score ~0.95 and are always two
 *      incidents. A signal with no coordinates skips the gate entirely: absent
 *      geography must never block grouping, it just cannot help;
 *   3. cosine against the surviving candidates' centroids; the best one wins if
 *      it clears the threshold, otherwise the signal seeds a new bubble.
 *
 * Every decision is written down twice: as a number (`weight`) and as a
 * sentence (`reason`) — "cosine 0.87; 400m and 12min apart". An operator who
 * cannot read why two reports were merged cannot act on the merge.
 */

/** Level 1 = signals grouped into incidents. Level 2 (themes) reuses this verb later. */
export const INCIDENT_LEVEL = 1;

/** Only bubbles that were alive this recently are candidates for a new signal. */
export const SIMILARITY_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The hard geographic gate at incident level — applied only when both sides have geo. */
export const GEO_GATE_METRES = 1500;

/** Velocity is "members in the last hour of the bubble's own clock". */
export const VELOCITY_WINDOW_MS = 60 * 60 * 1000;

/** Most recently active bubbles considered per signal. */
export const CANDIDATE_LIMIT = 50;

/**
 * The ONE place the join threshold lives.
 *
 * Two numbers because they are two different spaces: the real model's
 * similarities sit lower and spread wider than the lexical stub's, which leans
 * on a shared background component. Which one applies is decided by the same
 * switch that chooses the embedder — the presence of a Gateway key.
 */
export const JOIN_THRESHOLD = { real: 0.75, stub: 0.8 } as const;

export const AssignSignalResultSchema = z.object({
  signalId: z.uuid(),
  groupId: z.uuid(),
  /** false = this signal started a new bubble. */
  joined: z.boolean(),
  /** Cosine against the bubble's centroid at the moment of the decision. */
  similarity: z.number(),
  reason: z.string(),
  /** The bubble's re-folded member count, after this signal. */
  mass: z.number(),
  sourceDiversity: z.number().int(),
});

export type AssignSignalResult = z.infer<typeof AssignSignalResultSchema>;

export const assignSignalUseCase = createUseCase(
  {
    id: "assign-signal",
    inputSchema: z.object({ signalId: z.uuid() }),
    outputSchema: AssignSignalResultSchema,
  },
  async ({ success, error }, { signalId, log }) => {
    const signals = await getSignalsByIdsUseCase({ ids: [signalId], log });
    if (signals.error) return error(signals.error);

    const signal = signals.data[0];
    if (!signal) return error({ message: `Signal ${signalId} not found`, kind: "not_found" });
    if (!signal.embedding || signal.embedding.length === 0) {
      return error({ message: `Signal ${signalId} has no embedding`, kind: "not_embedded" });
    }

    const threshold = process.env.AI_GATEWAY_API_KEY ? JOIN_THRESHOLD.real : JOIN_THRESHOLD.stub;

    // ─── gate 1: time ─────────────────────────────────────────────────────────
    const candidates = await getActiveGroupsUseCase({
      level: INCIDENT_LEVEL,
      since: new Date(signal.occurredAt.getTime() - SIMILARITY_WINDOW_MS),
      limit: CANDIDATE_LIMIT,
      log,
    });
    if (candidates.error) return error(candidates.error);

    // ─── gate 2: geo · then similarity ────────────────────────────────────────
    let best: Match | null = null;
    let bestBlockedByGeo: Match | null = null;

    for (const candidate of candidates.data) {
      if (!candidate.centroidEmbedding || candidate.centroidEmbedding.length === 0) continue;

      const bothHaveGeo =
        signal.lat !== null &&
        signal.lng !== null &&
        candidate.centroidLat !== null &&
        candidate.centroidLng !== null;

      const metres = bothHaveGeo
        ? haversineMetres(
            { lat: signal.lat as number, lng: signal.lng as number },
            { lat: candidate.centroidLat as number, lng: candidate.centroidLng as number },
          )
        : null;

      const match: Match = {
        groupId: candidate.id,
        centroid: candidate.centroidEmbedding,
        centroidLat: candidate.centroidLat,
        centroidLng: candidate.centroidLng,
        mass: candidate.mass,
        lastSeen: candidate.lastSeen,
        metres,
        similarity: cosineSimilarity(signal.embedding, candidate.centroidEmbedding),
      };

      // The gate is absolute: a closer meaning never buys a longer distance.
      if (metres !== null && metres > GEO_GATE_METRES) {
        if (!bestBlockedByGeo || match.similarity > bestBlockedByGeo.similarity) {
          bestBlockedByGeo = match;
        }
        continue;
      }

      if (!best || match.similarity > best.similarity) best = match;
    }

    const joining = best !== null && best.similarity >= threshold;

    // ─── the decision, written down in words ──────────────────────────────────
    const reason = joining
      ? describeJoin(best as Match, signal)
      : describeSpawn(best, bestBlockedByGeo, threshold);

    // ─── place the signal ─────────────────────────────────────────────────────
    let groupId: string;
    let previousCentroid: number[] | null = null;
    let previousMass = 0;

    if (joining && best) {
      groupId = best.groupId;
      previousCentroid = best.centroid;
      previousMass = Math.max(0, best.mass);
    } else {
      const created = await createGroupUseCase({
        level: INCIDENT_LEVEL,
        centroidEmbedding: signal.embedding,
        centroidLat: signal.lat,
        centroidLng: signal.lng,
        firstSeen: signal.occurredAt,
        lastSeen: signal.occurredAt,
        log,
      });
      if (created.error) return error(created.error);
      groupId = created.data.id;
    }

    const edge = await createEdgeUseCase({
      fromId: signal.id,
      toId: groupId,
      rel: MEMBER_OF,
      weight: joining && best ? best.similarity : 1,
      reason,
      createdBy: "rule",
      log,
    });
    if (edge.error) return error(edge.error);

    // ─── re-fold the caches from the members that now exist ───────────────────
    const members = await getSignalsForGroupUseCase({ groupId, log });
    if (members.error) return error(members.error);

    const annotations = await getAnnotationsForNodesUseCase({
      nodeIds: members.data.map((m) => m.id),
      log,
    });
    if (annotations.error) return error(annotations.error);

    const folded = foldGroup({
      members: members.data,
      annotations: annotations.data,
      // O(1) centroid update on the hot path: the members' 1536-float vectors
      // are equivalent input, they are just far more of them to add up.
      centroid: runningCentroid(previousCentroid, previousMass, signal.embedding),
    });

    const updated = await updateGroupUseCase({ id: groupId, ...folded, log });
    if (updated.error) return error(updated.error);

    log?.info(
      {
        signalId: signal.id,
        groupId,
        joined: joining,
        similarity: Number((joining && best ? best.similarity : 1).toFixed(4)),
        threshold,
        mass: folded.mass,
        sourceDiversity: folded.sourceDiversity,
        reason,
      },
      joining ? "Signal joined an existing bubble" : "Signal seeded a new bubble",
    );

    return success({
      signalId: signal.id,
      groupId,
      joined: joining,
      similarity: joining && best ? best.similarity : 1,
      reason,
      mass: folded.mass,
      sourceDiversity: folded.sourceDiversity,
    });
  },
);

// ─── internals ────────────────────────────────────────────────────────────────

type Match = {
  groupId: string;
  centroid: number[];
  centroidLat: number | null;
  centroidLng: number | null;
  mass: number;
  lastSeen: Date;
  /** Distance to the centroid, or null when either side is ungeolocated. */
  metres: number | null;
  similarity: number;
};

/** "cosine 0.87; 400m and 12min apart" — the sentence an operator reads. */
function describeJoin(match: Match, signal: Signal): string {
  const apart = formatDuration(signal.occurredAt.getTime() - match.lastSeen.getTime());
  const where = match.metres === null ? "no coordinates to compare" : formatDistance(match.metres);
  return `cosine ${match.similarity.toFixed(2)}; ${where} and ${apart} apart`;
}

function describeSpawn(
  best: Match | null,
  blockedByGeo: Match | null,
  threshold: number,
): string {
  // The most useful thing to say is why the OBVIOUS match was refused.
  if (blockedByGeo && (!best || blockedByGeo.similarity > best.similarity)) {
    return `new bubble: closest match scored cosine ${blockedByGeo.similarity.toFixed(2)} but sits ${formatDistance(blockedByGeo.metres as number)} away (hard gate ${formatDistance(GEO_GATE_METRES)})`;
  }
  if (best) {
    return `new bubble: best active match scored cosine ${best.similarity.toFixed(2)}, under the ${threshold.toFixed(2)} join threshold`;
  }
  return `new bubble: no active bubble within ${formatDuration(SIMILARITY_WINDOW_MS)}`;
}

/**
 * Every cached metric on a group is a fold over its members — truncate the
 * groups, re-run the verb, get the same numbers back. This is that fold.
 */
function foldGroup(input: {
  members: Signal[];
  annotations: Annotation[];
  centroid: number[];
}): {
  centroidEmbedding: number[];
  centroidLat: number | null;
  centroidLng: number | null;
  mass: number;
  velocity: number;
  sourceDiversity: number;
  verification: Verification;
  firstSeen: Date;
  lastSeen: Date;
} {
  const { members } = input;
  const times = members.map((m) => m.occurredAt.getTime());
  const lastSeen = Math.max(...times);
  const firstSeen = Math.min(...times);

  const located = members.filter((m) => m.lat !== null && m.lng !== null);
  const centre = meanVector(located.map((m) => [m.lat as number, m.lng as number]));

  const sourceClasses = [...new Set(members.map((m) => m.sourceClass))].sort();

  const confidences = input.annotations
    .filter((a) => a.key === CONFIDENCE_KEY)
    .map((a) => Number(a.value))
    .filter((n) => Number.isFinite(n));

  const verifiedNodes = new Set(
    input.annotations
      .filter(
        (a) =>
          a.key === VERIFIED_KEY &&
          (VERIFIED_TRUE_VALUES as readonly string[]).includes(a.value.trim().toLowerCase()),
      )
      .map((a) => a.nodeId),
  );

  return {
    centroidEmbedding: input.centroid,
    centroidLat: centre.length === 2 ? centre[0] : null,
    centroidLng: centre.length === 2 ? centre[1] : null,
    mass: members.length,
    // Members inside the last hour of the bubble's OWN clock — occurred_at, not
    // wall clock, so replay and live produce identical numbers.
    velocity: times.filter((t) => t >= lastSeen - VELOCITY_WINDOW_MS).length,
    sourceDiversity: sourceClasses.length,
    verification: {
      // Counts, never a verdict: this says how much corroboration exists, not
      // that anything is true.
      verifiedCount: verifiedNodes.size,
      meanConfidence:
        confidences.length === 0
          ? null
          : confidences.reduce((sum, n) => sum + n, 0) / confidences.length,
      sourceClasses,
      distinctSources: new Set(members.map((m) => m.source)).size,
      distinctSourceClasses: sourceClasses.length,
    },
    firstSeen: new Date(firstSeen),
    lastSeen: new Date(lastSeen),
  };
}
