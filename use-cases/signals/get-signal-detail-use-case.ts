import { z } from "zod";
import { GradeSchema, MEMBER_OF } from "@/db/vocabulary";
import { getEdgesForNodesUseCase } from "@/use-cases/edges/get-edges-for-nodes-use-case";
import { getGradeEventsUseCase } from "@/use-cases/grade-events/get-grade-events-use-case";
import { getGroupUseCase } from "@/use-cases/groups/get-group-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { originIdFor } from "@/utilities/origin-fingerprint";
import { ScoredSignalSchema } from "./scored-signal-schema";
import { fingerprintItems, toScoredSignal } from "./get-signals-geojson-use-case";

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
   * Which distinct observation this item traces back to — the id of the
   * EARLIEST item in its collapsed set, so a reader can go and look at the
   * thing everything else here is an echo of. An item nothing collapsed with
   * is its own origin, which is the honest answer rather than a placeholder.
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
  /**
   * originId → the itemIds tracing to that one observation (AC8.2), each with
   * the sentence explaining why they were collapsed. A collapse an analyst
   * cannot read is a collapse they cannot overrule.
   */
  originGroups: z.array(
    z.object({
      originId: z.string(),
      itemIds: z.array(z.uuid()),
      reasons: z.array(z.string()),
    }),
  ),
  /** Oldest first — a history reads forwards. Append-only, never edited. */
  gradeHistory: z.array(GradeEventViewSchema),
});

export type SignalDetail = z.infer<typeof SignalDetailSchema>;

/** Stands in when an item has no edge — structurally impossible, but never lie. */
const MISSING_MEMBERSHIP = "membership edge missing — this item's placement is unexplained";

export const getSignalDetailUseCase = createUseCase(
  {
    id: "get-signal-detail",
    /** `asAt` = the panel under a time control: evidence captured by then only. */
    inputSchema: z.object({ signalId: z.uuid(), asAt: z.date().optional() }),
    outputSchema: SignalDetailSchema,
  },
  async ({ success, error }, { signalId, asAt, log }) => {
    const group = await getGroupUseCase({ id: signalId, log });
    if (group.error) return error(group.error);
    if (!group.data) return error({ message: `Signal ${signalId} not found`, kind: "not_found" });

    const allItems = await getSignalsForGroupUseCase({ groupId: signalId, log });
    if (allItems.error) return error(allItems.error);

    // The same clock the map scrubs on: what had been CAPTURED by that instant
    // (ingested_at), never when it occurred. A panel and a pin describing the
    // same instant from two different clocks is exactly the desync this exists
    // to prevent.
    const inHand = asAt
      ? allItems.data.filter((item) => item.ingestedAt <= asAt)
      : allItems.data;
    if (inHand.length === 0) {
      return error({
        message: `Nothing had been captured for ${signalId} by that instant`,
        kind: "not_found",
      });
    }

    const edges = await getEdgesForNodesUseCase({ nodeIds: [signalId], log });
    if (edges.error) return error(edges.error);

    const history = await getGradeEventsUseCase({ groupIds: [signalId], asAt, order: "asc", log });
    if (history.error) return error(history.error);

    // The grade as at an instant is the last transition at or before it — the
    // same rule the map applies (AC24.2). No transition yet = same fallback as
    // the map: the stored grade.
    const lastEvent = asAt ? history.data.at(-1) : undefined;
    const asAtGrade = lastEvent
      ? {
          grade: lastEvent.toGrade,
          reasons: lastEvent.reasons,
          independentSources: lastEvent.independentSources,
        }
      : undefined;

    const membershipByItem = new Map(
      edges.data.filter((e) => e.rel === MEMBER_OF && e.toId === signalId).map((e) => [e.fromId, e]),
    );

    // The SAME fingerprint the grade was computed from, recomputed from the
    // same items rather than cached — so the origin count printed beside the
    // grade and the origin groups printed underneath it can never disagree.
    const fingerprint = fingerprintItems(inHand);

    const provenance = inHand.map((item) => {
      const edge = membershipByItem.get(item.id);
      return {
        itemId: item.id,
        originId: originIdFor(fingerprint, item.id),
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

    log?.info(
      {
        signalId,
        asAt: asAt?.toISOString() ?? null,
        itemCount: provenance.length,
        independentSources: fingerprint.independentOrigins,
        gradeEvents: history.data.length,
      },
      "Opened a signal's provenance and grade history",
    );

    return success({
      ...toScoredSignal({ group: group.data, items: inHand, asAtGrade, fingerprint }),
      provenance,
      originGroups: fingerprint.originGroups,
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

