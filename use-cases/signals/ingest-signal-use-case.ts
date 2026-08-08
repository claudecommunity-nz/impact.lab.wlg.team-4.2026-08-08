import { z } from "zod";
import {
  ASSUMED_OCCURRED_AT_KEY,
  EMBEDDING_MODEL_KEY,
  GEO_DROPPED_KEY,
  GradeSchema,
  MEMBER_OF,
} from "@/db/vocabulary";
import { embedSignalsUseCase } from "@/use-cases/ai/embed-signals-use-case";
import { createAnnotationsUseCase } from "@/use-cases/annotations/create-annotations-use-case";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { gradeClusterUseCase } from "@/use-cases/grading/grade-cluster-use-case";
import { assignSignalUseCase } from "@/use-cases/vectors/assign-signal-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { genericJsonAdapter } from "@/utilities/adapters/generic-json-adapter";
import { type Logger } from "@/utilities/logger";
import { createSignalUseCase } from "./create-signal-use-case";
import { getSignalByDedupeUseCase } from "./get-signal-by-dedupe-use-case";
import { updateSignalEmbeddingUseCase } from "./update-signal-embedding-use-case";

/**
 * What every ingest path returns.
 *
 * A SUPERSET, deliberately. Every field the already-published INTEGRATION.md
 * promised is still here, spelled the same way and meaning the same thing; the
 * PRD's names (`itemId`, `signalId`, `grade`) are additions beside them, not
 * replacements. A sender who integrated against the intake yesterday keeps
 * working with no change; one integrating against the trust surface today gets
 * the cluster and its grade back from the same call.
 */
export const IngestSignalResultSchema = z.object({
  // ─── the intake contract, unchanged ─────────────────────────────────────────
  id: z.uuid(),
  /** false = this payload matched an existing signal and was NOT stored again. */
  created: z.boolean(),
  /** The honest sentence we derived — check this if a payload reads oddly. */
  text: z.string(),
  source: z.string(),
  sourceClass: z.string(),
  occurredAt: z.date(),
  /** True when occurred_at was absent and defaulted to ingest time. */
  assumedOccurredAt: z.boolean(),
  /**
   * True when coordinates were sent but not usable (out of WGS84 range, or only
   * half a pair), so this signal is ungeolocated. The values are still in `raw`,
   * and a `geo_dropped` annotation records why — silence would look identical
   * to sending no coordinates at all.
   */
  geoDropped: z.boolean(),
  /** The annotation keys we kept from the payload. */
  annotationKeys: z.array(z.string()),

  // ─── the trust surface (convergence Decision 2) ──────────────────────────────
  /** The same value as `id`, under the PRD's name for one raw item. */
  itemId: z.uuid(),
  /** The CLUSTER this item was folded into — the PRD's "signal". Null if unplaced. */
  signalId: z.uuid().nullable(),
  /** The cluster's grade AFTER this item was folded in (AC1.2). Null if unplaced. */
  grade: GradeSchema.nullable(),
  /** Ordered reasons behind that grade. Empty if unplaced. */
  reasons: z.array(z.string()),
  /** Computed independently of the grade — a weak early signal still alerts. */
  alertWorthy: z.boolean(),
  /** Distinct origins in the cluster. Placeholder until fingerprinting lands. */
  independentSources: z.number().int(),
  /** Items in the cluster — always reported separately from independentSources. */
  itemCount: z.number().int(),
  datasetId: z.string(),
  externalId: z.string().nullable(),
  /** True when this item was authored for a demo or a drill. */
  synthetic: z.boolean(),
  /**
   * Non-fatal trouble inside the synchronous fold, one sentence each. The item
   * is stored either way — losing an observation because an embedder timed out
   * would be the worst possible trade — but we never pretend it was placed.
   */
  foldWarnings: z.array(z.string()),
});

export type IngestSignalResult = z.infer<typeof IngestSignalResultSchema>;

/**
 * The universal intake — the single entry point for BOTH the push path (tRPC
 * `signals.ingest`) and the pull path (the inbox poller), for our collectors,
 * their collectors, and the other teams. Everything that enters enters here.
 *
 * The business logic:
 *   1. an adapter turns ANY payload into an honest sentence + feed annotations
 *      (it never throws — a payload we cannot read is a reported failure);
 *   2. occurred_at is optional: absent means now, and we SAY SO by writing an
 *      `assumed_occurred_at` annotation rather than silently inventing a time;
 *   3. dedupe per convergence Decision 4 — `(dataset, source, external_id)`
 *      when the collector gave us an id, `(dataset, source, text, occurred_at)`
 *      when it did not. TWO layers, on purpose: a cheap SELECT that answers the
 *      common re-delivery case without writing, and the partial unique indexes
 *      behind it that make the guarantee hold when the same report arrives ten
 *      times AT ONCE (batched clients, parallel pollers) — the select alone is
 *      a race every concurrent caller loses together;
 *   4. write the signal and its annotations in one transaction;
 *   5. **fold it, synchronously**: embed → assign → grade, so the caller gets
 *      back the cluster this item joined and that cluster's grade *after* the
 *      item was counted (Decision 2, PRD AC1.1/AC1.2).
 *
 * Step 5 is synchronous because the alternative — "we stored it, ask again
 * later" — pushes the whole trust question onto every sender, and none of them
 * should have to poll to find out whether the thing they just reported was
 * already being reported by three other people.
 *
 * A duplicate is folded too, but writes nothing new: it re-reads the cluster the
 * original already sits in, so `itemCount` and `independentSources` are
 * unchanged by re-delivery (AC2.3).
 */
export const ingestSignalUseCase = createUseCase(
  {
    id: "ingest-signal",
    inputSchema: z.object({
      /** ANY JSON payload — shape is the adapter's problem, not the sender's. */
      payload: z.unknown(),
      /** Threaded like `log`; absent means live. Replay passes a virtual clock. */
      now: z.date().optional(),
    }),
    outputSchema: IngestSignalResultSchema,
  },
  async ({ success, error }, { payload, now, log }) => {
    const at = now ?? new Date();

    const adapted = genericJsonAdapter(payload);
    if (!adapted.ok) {
      log?.warn({ reason: adapted.reason }, "Ingest rejected: payload could not be adapted");
      return error({ message: adapted.reason, kind: "adapter_rejected" });
    }

    const incoming = adapted.signal;
    const assumedOccurredAt = incoming.occurredAt === undefined;
    const occurredAt = incoming.occurredAt ?? at;
    const geoDropped = incoming.annotations.some((a) => a.key === GEO_DROPPED_KEY);

    // ─── store (or recognise) the item ────────────────────────────────────────
    const existing = await getSignalByDedupeUseCase({
      datasetId: incoming.datasetId,
      source: incoming.source,
      text: incoming.text,
      occurredAt,
      externalId: incoming.externalId,
      log,
    });
    if (existing.error) return error(existing.error);

    let signalId: string;
    let stored: {
      text: string;
      source: string;
      sourceClass: string;
      occurredAt: Date;
      datasetId: string;
      externalId: string | null;
      synthetic: boolean;
      embedded: boolean;
    };
    let created: boolean;
    let annotationKeys: string[];

    if (existing.data) {
      log?.info({ signalId: existing.data.id }, "Ingest deduped: signal already stored");
      signalId = existing.data.id;
      created = false;
      annotationKeys = incoming.annotations.map((a) => a.key);
      stored = {
        text: existing.data.text,
        source: existing.data.source,
        sourceClass: existing.data.sourceClass,
        occurredAt: existing.data.occurredAt,
        datasetId: existing.data.datasetId,
        externalId: existing.data.externalId,
        synthetic: existing.data.synthetic,
        embedded: (existing.data.embedding?.length ?? 0) > 0,
      };
    } else {
      // Say what we assumed, in the same open vocabulary as everything else.
      const annotations = assumedOccurredAt
        ? [
            ...incoming.annotations,
            { key: ASSUMED_OCCURRED_AT_KEY, value: "true", annotator: "rule" as const },
          ]
        : incoming.annotations;

      const write = await createSignalUseCase({
        source: incoming.source,
        sourceClass: incoming.sourceClass,
        text: incoming.text,
        occurredAt,
        raw: incoming.raw,
        lat: incoming.lat,
        lng: incoming.lng,
        geoConfidence: incoming.geoConfidence,
        datasetId: incoming.datasetId,
        externalId: incoming.externalId,
        author: incoming.author,
        url: incoming.url,
        quotedUrls: incoming.quotedUrls,
        synthetic: incoming.synthetic,
        annotations,
        log,
      });
      if (write.error) return error(write.error);

      // The select above missed but a unique index caught it: a concurrent
      // caller stored this exact observation between our read and our write.
      // That is a dedupe, not a failure — report it as one.
      signalId = write.data.signal.id;
      created = write.data.created;
      annotationKeys = write.data.created
        ? write.data.annotations.map((a) => a.key)
        : incoming.annotations.map((a) => a.key);
      stored = {
        text: write.data.signal.text,
        source: write.data.signal.source,
        sourceClass: write.data.signal.sourceClass,
        occurredAt: write.data.signal.occurredAt,
        datasetId: write.data.signal.datasetId,
        externalId: write.data.signal.externalId,
        synthetic: write.data.signal.synthetic,
        embedded: (write.data.signal.embedding?.length ?? 0) > 0,
      };

      log?.info(
        {
          signalId,
          datasetId: stored.datasetId,
          sourceClass: incoming.sourceClass,
          assumedOccurredAt,
          annotationCount: annotations.length,
          geolocated: incoming.lat !== undefined && incoming.lng !== undefined,
          geoDropped,
        },
        created ? "Ingest stored a new signal" : "Ingest deduped: lost the write race, kept one row",
      );
    }

    // ─── fold it: embed → assign → grade ──────────────────────────────────────
    const fold = await foldItem({
      signalId,
      text: stored.text,
      embedded: stored.embedded,
      now: at,
      log,
    });

    return success({
      id: signalId,
      created,
      text: stored.text,
      source: stored.source,
      sourceClass: stored.sourceClass,
      occurredAt: stored.occurredAt,
      assumedOccurredAt,
      geoDropped,
      annotationKeys,

      itemId: signalId,
      signalId: fold.groupId,
      grade: fold.grade,
      reasons: fold.reasons,
      alertWorthy: fold.alertWorthy,
      independentSources: fold.independentSources,
      itemCount: fold.itemCount,
      datasetId: stored.datasetId,
      externalId: stored.externalId,
      synthetic: stored.synthetic,
      foldWarnings: fold.warnings,
    });
  },
);

/**
 * The synchronous fold, and the ONE place in the intake that degrades instead of
 * failing.
 *
 * An item that is stored but unplaced is a RECOVERABLE state — `vectors.process`
 * picks it up on its next sweep — whereas an ingest that 500s because an
 * embedder was slow is a lost observation, and observations are the only thing
 * here that cannot be rebuilt. So each stage records a warning and stops, and
 * the response says `signalId: null` rather than inventing a cluster.
 */
async function foldItem(args: {
  signalId: string;
  text: string;
  embedded: boolean;
  now: Date;
  log?: Logger;
}): Promise<{
  groupId: string | null;
  grade: z.infer<typeof GradeSchema> | null;
  reasons: string[];
  alertWorthy: boolean;
  independentSources: number;
  itemCount: number;
  warnings: string[];
}> {
  const { signalId, now, log } = args;
  const warnings: string[] = [];
  const unplaced = {
    groupId: null,
    grade: null,
    reasons: [] as string[],
    alertWorthy: false,
    independentSources: 0,
    itemCount: 0,
  };

  // ─── 1. embed ─────────────────────────────────────────────────────────────
  if (!args.embedded) {
    const embedded = await embedSignalsUseCase({ texts: [args.text], log });
    if (embedded.error) {
      warnings.push(`not embedded: ${embedded.error.message} — vectors.process will retry`);
      return { ...unplaced, warnings };
    }

    const written = await updateSignalEmbeddingUseCase({
      id: signalId,
      embedding: embedded.data.embeddings[0],
      log,
    });
    if (written.error) {
      warnings.push(`embedding not stored: ${written.error.message} — vectors.process will retry`);
      return { ...unplaced, warnings };
    }

    // Say WHICH embedder placed this item. A cluster built by the lexical stub
    // and one built by the real model are not the same claim.
    const provenance = await createAnnotationsUseCase({
      annotations: [
        {
          nodeId: signalId,
          key: EMBEDDING_MODEL_KEY,
          value: embedded.data.model,
          annotator: "rule",
        },
      ],
      log,
    });
    if (provenance.error) warnings.push(`embedder not recorded: ${provenance.error.message}`);
  }

  // ─── 2. assign ────────────────────────────────────────────────────────────
  // A re-delivery is already in a cluster. Re-assigning it would MOVE it (the
  // member_of index updates in place), quietly re-writing history because
  // somebody sent the same thing twice — and `itemCount` must be unchanged by a
  // duplicate (AC2.3). So look first, and only place what is not yet placed.
  let groupId = await findExistingCluster({ signalId, log });

  if (groupId === null) {
    const placed = await assignSignalUseCase({ signalId, now, log });
    if (placed.error) {
      warnings.push(`not clustered: ${placed.error.message} — vectors.process will retry`);
      return { ...unplaced, warnings };
    }
    groupId = placed.data.groupId;
  }

  // ─── 3. grade ─────────────────────────────────────────────────────────────
  const graded = await gradeClusterUseCase({ groupId, now, log });
  if (graded.error) {
    warnings.push(`not graded: ${graded.error.message}`);
    return { ...unplaced, groupId, warnings };
  }

  return {
    groupId,
    grade: graded.data.grade,
    reasons: graded.data.reasons,
    alertWorthy: graded.data.alertWorthy,
    independentSources: graded.data.independentSources,
    itemCount: graded.data.itemCount,
    warnings,
  };
}

/** The cluster this item already belongs to, or null. A signal has at most one. */
async function findExistingCluster(args: { signalId: string; log?: Logger }): Promise<string | null> {
  const edges = await getEdgesForNodesUseCase({ nodeIds: [args.signalId], log: args.log });
  if (edges.error) return null;
  const membership = edges.data.find((e) => e.rel === MEMBER_OF && e.fromId === args.signalId);
  return membership?.toId ?? null;
}
