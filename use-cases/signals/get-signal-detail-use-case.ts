import { z } from "zod";
import { GradeSchema, MEMBER_OF } from "@/db/vocabulary";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { getGradeEventsUseCase } from "@/use-cases/grade-events/get-grade-events-use-case";
import { getGroupUseCase } from "@/use-cases/groups/get-group-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { ScoredSignalSchema } from "./scored-signal-schema";
import { toScoredSignal } from "./get-signals-geojson-use-case";

/**
 * One cluster, opened all the way down: every item behind it, grouped by origin,
 * with the verbatim words somebody published and the full history of what we
 * believed about it and when.
 *
 * This read is the point of the whole module. A map marker saying "probably
 * true" is worth nothing to an intelligence team unless they can open it and
 * judge the evidence themselves — read the original posts, see who said what
 * and when we learned of it, see which items are actually the same observation
 * wearing three hats, and see the grade move as the evidence arrived.
 *
 * Unlike `signals.geojson`, this returns clusters that CANNOT BE PLACED on a
 * map (AC12.3). A report with no resolvable location is still evidence; it is
 * only undrawable.
 */

export const ProvenanceEntrySchema = z.object({
  /** The raw item's id — the PRD's `itemId`. */
  itemId: z.uuid(),
  /**
   * Which distinct observation this item traces back to. PLACEHOLDER: until
   * origin fingerprinting lands, each item is its own origin, so this is the
   * item's own id. `independentSources` above is the number that matters, and
   * it says in its reasons that it is not yet real.
   */
  originId: z.string(),
  source: z.string(),
  sourceClass: z.string(),
  /** The account or byline, when the source distinguishes them. */
  author: z.string().nullable(),
  url: z.string().nullable(),
  /** The links this item quotes — a repost is not an independent observation. */
  quotedUrls: z.array(z.string()),
  /** The words somebody actually published. Verbatim, never rewritten. */
  excerpt: z.string(),
  /** When it happened / was published — the PRD's `publishedAt`. */
  occurredAt: z.date(),
  /** When WE learned of it — the PRD's `capturedAt`. `asAt` filters on this. */
  ingestedAt: z.date(),
  /** Authored for a demo or a drill. Carried to EVERY provenance entry (AC34.2). */
  synthetic: z.boolean(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  /** Why this item was placed in this cluster, in words and as a number. */
  membershipReason: z.string(),
  membershipWeight: z.number().nullable(),
});

export const GradeEventViewSchema = z.object({
  at: z.date(),
  fromGrade: GradeSchema.nullable(),
  toGrade: GradeSchema,
  independentSources: z.number().int(),
  itemCount: z.number().int(),
  reasons: z.array(z.string()),
  alertFired: z.boolean(),
  alertReasons: z.array(z.string()).nullable(),
});

export const SignalDetailSchema = ScoredSignalSchema.extend({
  /** Every item behind this cluster, newest first. Never empty. */
  provenance: z.array(ProvenanceEntrySchema),
  /** originId → the itemIds tracing to that one observation (AC7.2). */
  originGroups: z.array(z.object({ originId: z.string(), itemIds: z.array(z.uuid()) })),
  /** Oldest first — a history reads forwards. Append-only, never edited. */
  gradeHistory: z.array(GradeEventViewSchema),
});

export type SignalDetail = z.infer<typeof SignalDetailSchema>;

/** Stands in when an item has no edge — structurally impossible, but never lie. */
const MISSING_MEMBERSHIP = "membership edge missing — this item's placement is unexplained";

export const getSignalDetailUseCase = createUseCase(
  {
    id: "get-signal-detail",
    inputSchema: z.object({ signalId: z.uuid() }),
    outputSchema: SignalDetailSchema,
  },
  async ({ success, error }, { signalId, log }) => {
    const group = await getGroupUseCase({ id: signalId, log });
    if (group.error) return error(group.error);
    if (!group.data) return error({ message: `Signal ${signalId} not found`, kind: "not_found" });

    const items = await getSignalsForGroupUseCase({ groupId: signalId, log });
    if (items.error) return error(items.error);

    const edges = await getEdgesForNodesUseCase({ nodeIds: [signalId], log });
    if (edges.error) return error(edges.error);

    const history = await getGradeEventsUseCase({ groupIds: [signalId], order: "asc", log });
    if (history.error) return error(history.error);

    const membershipByItem = new Map(
      edges.data.filter((e) => e.rel === MEMBER_OF && e.toId === signalId).map((e) => [e.fromId, e]),
    );

    const provenance = items.data.map((item) => {
      const edge = membershipByItem.get(item.id);
      return {
        itemId: item.id,
        // Placeholder identity: one item, one origin, until fingerprinting lands.
        originId: item.id,
        source: item.source,
        sourceClass: item.sourceClass,
        author: item.author,
        url: item.url,
        quotedUrls: item.quotedUrls ?? [],
        excerpt: item.text,
        occurredAt: item.occurredAt,
        ingestedAt: item.ingestedAt,
        synthetic: item.synthetic,
        lat: item.lat,
        lng: item.lng,
        membershipReason: edge?.reason ?? MISSING_MEMBERSHIP,
        membershipWeight: edge?.weight ?? null,
      };
    });

    const originGroups = [...groupBy(provenance)].map(([originId, itemIds]) => ({
      originId,
      itemIds,
    }));

    log?.info(
      { signalId, itemCount: provenance.length, gradeEvents: history.data.length },
      "Opened a signal's provenance and grade history",
    );

    return success({
      ...toScoredSignal({ group: group.data, items: items.data }),
      provenance,
      originGroups,
      gradeHistory: history.data.map((event) => ({
        at: event.at,
        fromGrade: event.fromGrade,
        toGrade: event.toGrade,
        independentSources: event.independentSources,
        itemCount: event.itemCount,
        reasons: event.reasons,
        alertFired: event.alertFired,
        alertReasons: event.alertReasons,
      })),
    });
  },
);

function groupBy(entries: { originId: string; itemId: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of entries) {
    const existing = out.get(entry.originId);
    if (existing) existing.push(entry.itemId);
    else out.set(entry.originId, [entry.itemId]);
  }
  return out;
}
