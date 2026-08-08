import { ASSUMED_OCCURRED_AT_KEY, type SourceReliability } from "@/db/vocabulary";
import { type Annotation } from "@/repositories/annotations/annotation-schema";
import { type Signal } from "@/repositories/signals/signal-schema";
import {
  bestSourceReliability,
  type ClusterFacts,
  type HazardCrossCheck,
  type LocationCertainty,
  type TimeCertainty,
} from "@/utilities/grading";
import { classifyIssueType, type IssueType } from "@/utilities/issue-type";
import { fingerprintOrigins, type OriginFingerprint } from "@/utilities/origin-fingerprint";

/**
 * Stored rows → the facts the rule table grades. Pure — no db, no HTTP, no
 * clock; the caller has already fetched everything and threads `now` in.
 *
 * It exists as its own module because THREE surfaces need the same answer and
 * a cluster must not be able to describe itself differently in three places:
 * the grading use case (which writes the verdict), `signals.geojson` and
 * `signals.detail` (which publish `independentSources`, `originGroups` and
 * `locationCertainty` beside it). A read that counted origins its own way would
 * eventually disagree with the grade printed next to it, and the number a duty
 * officer acts on would depend on which endpoint they happened to open.
 */

/**
 * The honest default for the authoritative cross-check.
 *
 * There is no river-gauge or susceptibility lookup wired to a claim yet, and
 * the difference between "we checked and nothing disagreed" and "nothing has
 * checked this" is exactly the difference this system exists to keep visible.
 * So the default says the second thing, out loud, in every `reasons` array —
 * and the credibility-2 rule, which requires a CONSISTENT cross-check, stays
 * correctly out of reach until a real layer answers.
 */
export const NO_APPLICABLE_LAYER: HazardCrossCheck = {
  result: "no_applicable_layer",
  detail: "no authoritative hazard or telemetry layer is wired to this claim yet",
};

export type ClusterFactsResult = {
  facts: ClusterFacts;
  fingerprint: OriginFingerprint;
  originGroups: OriginFingerprint["originGroups"];
  reliability: ReturnType<typeof bestSourceReliability>;
};

export function clusterFactsFromItems(input: {
  items: readonly Signal[];
  /** Every annotation on those items — read for `assumed_occurred_at`. */
  annotations?: readonly Annotation[];
  /** sourceId → reliability. A source missing from it is F, by construction. */
  registry?: ReadonlyMap<string, SourceReliability>;
  /** Classified from the items' own words when not supplied. */
  issueType?: IssueType;
  /** Supplied once a real layer answers; the honest default until then. */
  hazardCrossCheck?: HazardCrossCheck;
  now: Date;
}): ClusterFactsResult {
  const items = input.items;
  const fingerprint = fingerprintOrigins(
    items.map((item) => ({
      id: item.id,
      source: item.source,
      author: item.author,
      url: item.url,
      quotedUrls: item.quotedUrls,
      text: item.text,
      embedding: item.embedding,
      occurredAt: item.occurredAt,
    })),
  );

  const reliability = bestSourceReliability({
    sourceIds: items.map((item) => item.source),
    registry: input.registry ?? new Map(),
  });

  const times = items.map((item) => item.occurredAt.getTime());

  return {
    facts: {
      independentOrigins: fingerprint.independentOrigins,
      itemCount: items.length,
      bestSourceReliability: reliability.reliability,
      bestSourceId: reliability.sourceId,
      registeredSourceCount: reliability.registered.length,
      unregisteredSourceCount: reliability.unregistered.length,
      hazardCrossCheck: input.hazardCrossCheck ?? NO_APPLICABLE_LAYER,
      locationCertainty: locationCertaintyOf(items),
      timeCertainty: timeCertaintyOf(items, input.annotations ?? []),
      contradictingOrigins: 0,
      issueType: input.issueType ?? classifyIssueType(items.map((item) => item.text)),
      firstSeen: new Date(times.length > 0 ? Math.min(...times) : input.now.getTime()),
      lastSeen: new Date(times.length > 0 ? Math.max(...times) : input.now.getTime()),
      now: input.now,
    },
    fingerprint,
    originGroups: fingerprint.originGroups,
    reliability,
  };
}

/**
 * Did a SOURCE say where this is, or did we work it out?
 *
 * The adapter records confidence 1 when the payload itself carried coordinates
 * and leaves anything lower for a geocoder to write, so the distinction is
 * already in the data — it just has to be read rather than guessed. One stated
 * coordinate is enough to make the cluster "stated": that point is exactly
 * where somebody said it was, whatever else was averaged around it.
 */
export function locationCertaintyOf(items: readonly Signal[]): LocationCertainty {
  const located = items.filter((item) => item.lat !== null && item.lng !== null);
  if (located.length === 0) return "unknown";
  if (located.some((item) => item.geoConfidence === null || item.geoConfidence >= 1)) return "stated";
  return "inferred";
}

/**
 * Did a collector say WHEN, or did ingest default it to the moment we heard?
 *
 * `assumed` is a weakness worth printing, not an unjudgeable cluster: we do
 * know when we learned of it. Only a cluster with no items at all is genuinely
 * `unknown`, and that one never reaches the rule table.
 */
export function timeCertaintyOf(
  items: readonly Signal[],
  annotations: readonly Annotation[],
): TimeCertainty {
  if (items.length === 0) return "unknown";
  const assumed = new Set(
    annotations.filter((a) => a.key === ASSUMED_OCCURRED_AT_KEY).map((a) => a.nodeId),
  );
  return items.some((item) => !assumed.has(item.id)) ? "stated" : "assumed";
}
