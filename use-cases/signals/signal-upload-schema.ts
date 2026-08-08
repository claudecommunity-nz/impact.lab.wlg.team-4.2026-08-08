import { z } from "zod";
import { type Signal, SourceKind } from "./signal-schema";

/**
 * The OUTBOUND contract — the shape the trust/scoring service ingests. This is
 * the only place that shape is written down; everything else speaks `Signal`
 * and is mapped here at the boundary.
 *
 * Two rules from the spec that are easy to break and expensive to get wrong:
 *
 * 1. "EVERYTHING ELSE: extra fields are stored verbatim and shown to analysts
 *    in the evidence drill-down. Never strip." So the mapper spreads `extra`
 *    rather than picking a whitelist — an unknown field is evidence, not noise.
 * 2. `synthetic` is carried through to provenance and always visible. It
 *    therefore defaults to `false` ONLY for genuinely collected items; anything
 *    hand-authored must set it true at the point of authoring, never here.
 */

export const SignalAnnotationSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const SignalUploadItemSchema = z
  .object({
    // ── REQUIRED ──
    text: z.string().min(1),

    // ── STRONGLY WANTED — each directly powers scoring ──
    source: z.string().optional(),
    /** Suggested: social | media | official_feed | sensor | community_report. */
    sourceClass: z.string().optional(),
    /** ISO 8601. Omitted → the service stamps arrival and flags it as assumed. */
    occurredAt: z.string().optional(),
    /** Our stable id → re-sending or re-scraping is always safe. */
    externalId: z.string().optional(),
    /** Account/byline, so one prolific poster isn't counted as corroboration. */
    author: z.string().optional(),
    url: z.string().optional(),
    /** Links it quotes/shares/reposts → reposts don't count as second witnesses. */
    quotedUrls: z.array(z.string()).optional(),

    // ── GEO — send whatever we have ──
    lat: z.number().optional(),
    lng: z.number().optional(),
    /** 0–1, when the location was guessed rather than stated. */
    geoConfidence: z.number().min(0).max(1).optional(),
    annotations: z.array(SignalAnnotationSchema).optional(),

    // ── HYGIENE ──
    /** "live" for real scraping; anything else for replays/fixtures. */
    datasetId: z.string().optional(),
    /** true for any hand-authored demo item. */
    synthetic: z.boolean().optional(),
  })
  // Extra keys are meaningful to analysts — keep them.
  .passthrough();

export type SignalUploadItem = z.infer<typeof SignalUploadItemSchema>;

/** Our source kinds → the vocabulary the scoring service suggests. */
const SOURCE_CLASS: Record<string, string> = {
  [SourceKind.Official]: "official_feed",
  [SourceKind.OfficialCrowd]: "community_report",
  [SourceKind.News]: "media",
  [SourceKind.Social]: "social",
};

/**
 * Signal → upload item.
 *
 * `location_text` is always sent when we have any place wording, per the spec's
 * "ALWAYS send place text when there are no coords" — we send it even when we
 * do have coords, because it lets an analyst check our geocoding rather than
 * trust it.
 */
export function toSignalUploadItem(
  signal: Signal,
  options: { datasetId: string; synthetic: boolean },
): SignalUploadItem {
  const annotations: Array<{ key: string; value: string }> = [];

  if (signal.location?.matchedPlace) {
    annotations.push({
      key: "location_text",
      value: signal.location.matchedPlace,
    });
  } else if (signal.locationText) {
    annotations.push({ key: "location_text", value: signal.locationText });
  }

  if (signal.mediaUrl) {
    annotations.push({ key: "image_url", value: signal.mediaUrl });
  }

  // How the point was derived — an analyst should never have to guess whether a
  // pin was surveyed, reprojected from NZTM2000, or inferred from a place name.
  annotations.push({
    key: "location_method",
    value: signal.location?.method ?? "none",
  });

  for (const limitation of signal.limitations) {
    annotations.push({ key: "limitation", value: limitation });
  }

  return {
    text: signal.text,
    source: signal.source,
    sourceClass: SOURCE_CLASS[signal.sourceKind] ?? signal.sourceKind,
    occurredAt: signal.observedAt.toISOString(),
    externalId: signal.externalId,
    ...(signal.authorRef ? { author: signal.authorRef } : {}),
    ...(signal.url ? { url: signal.url } : {}),
    ...(signal.quotedUrls.length > 0 ? { quotedUrls: signal.quotedUrls } : {}),
    ...(signal.location
      ? {
          lat: signal.location.lat,
          lng: signal.location.lng,
          geoConfidence: signal.location.confidence,
        }
      : {}),
    annotations,
    datasetId: options.datasetId,
    synthetic: options.synthetic,

    // Extra fields — stored verbatim and surfaced in the drill-down.
    hazardType: signal.hazardType,
    mediaType: signal.mediaType,
    collectedAt: signal.collectedAt.toISOString(),
    authorIsPseudonymised: signal.authorRef !== null,
  };
}
