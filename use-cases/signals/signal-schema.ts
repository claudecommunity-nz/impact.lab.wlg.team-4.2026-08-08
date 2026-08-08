import { z } from "zod";

/**
 * The normalized shape EVERY source collapses into — social posts, official
 * ArcGIS features, news items. One contract so the map, the trust API and any
 * other team's module can read our output without knowing the source.
 *
 * These are NOT persisted entities (there is no signals table), so the schema
 * lives with the domain rather than in `repositories/`.
 *
 * Problem 03 is explicitly about making reliability legible, so provenance is
 * part of the contract, not a nice-to-have: every signal carries where it came
 * from, how its location was derived, and whether anyone has verified it.
 */

/** Who published it — drives how much weight a signal may be given. */
export const SourceKind = {
  /** Authoritative agency feed (MetService, NEMA, NZTA, GeoNet quakes). */
  Official: "official",
  /** Public report captured through an official channel (water faults, felt reports). */
  OfficialCrowd: "official-crowd",
  /** Newsroom output — edited, but secondhand. */
  News: "news",
  /** Public social post — unverified, always. */
  Social: "social",
} as const;

export const SourceKindSchema = z.enum([
  SourceKind.Official,
  SourceKind.OfficialCrowd,
  SourceKind.News,
  SourceKind.Social,
]);

/** How a lat/lng was arrived at. Never let a guessed point look like a surveyed one. */
export const LocationMethod = {
  /** The source supplied coordinates. */
  Exact: "exact",
  /** Reprojected from the publisher's native grid (NZTM2000 → WGS84). */
  Reprojected: "reprojected",
  /** Matched a place name in the text against the Wellington gazetteer. */
  PlaceName: "place-name",
  /** Nothing usable — the signal has no location. */
  None: "none",
} as const;

export const LocationMethodSchema = z.enum([
  LocationMethod.Exact,
  LocationMethod.Reprojected,
  LocationMethod.PlaceName,
  LocationMethod.None,
]);

/** Coarse issue type. Deliberately small — an intelligence team triages, not us. */
export const HazardTypeSchema = z.enum([
  "flooding",
  "landslide",
  "earthquake",
  "fire",
  "wind",
  "power",
  "water",
  "transport",
  "coastal",
  "other",
]);

export const MediaTypeSchema = z.enum(["none", "photo", "video", "link"]);

export const SignalLocationSchema = z.object({
  /** WGS84. Always lng/lat order internally to match GeoJSON. */
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  /** 0–1. Honest about how much we trust the point itself. */
  confidence: z.number().min(0).max(1),
  method: LocationMethodSchema,
  /** The place name matched, when method is place-name. */
  matchedPlace: z.string().nullable(),
  /**
   * The raw place wording as the source expressed it ("Aro Valley, near the
   * shops"). Sent onward even when we have coordinates, and it is the ONLY
   * geo evidence we can offer when we don't.
   */
  locationText: z.string().nullable(),
});

export const SignalSchema = z.object({
  /** Stable id derived from source + native id, so repeat polls dedupe. */
  id: z.string(),
  /**
   * The publisher's own id for this item (Reddit's `t3_...`, an ArcGIS
   * OBJECTID, a GeoNet publicID). Sent upstream so re-scraping is idempotent.
   */
  externalId: z.string(),
  source: z.string(),
  sourceKind: SourceKindSchema,
  /** The human-readable claim. Never treated as fact. */
  text: z.string(),
  /** When the source says it happened/was published. */
  observedAt: z.coerce.date(),
  /** When we pulled it. */
  collectedAt: z.coerce.date(),
  location: SignalLocationSchema.nullable(),
  /** Raw place wording from the source, kept even when coordinates exist. */
  locationText: z.string().nullable(),
  hazardType: HazardTypeSchema,
  mediaType: MediaTypeSchema,
  url: z.string().nullable(),
  /** Direct link to an attached photo/video, when the source exposes one. */
  mediaUrl: z.string().nullable(),
  /**
   * Links this item quotes, shares or reposts. Critical for scoring: a repost
   * of a news article is not a second independent witness of the event.
   */
  quotedUrls: z.array(z.string()),
  /**
   * Pseudonymised author reference. NEVER a raw handle: this repo is public and
   * must stay free of personal information.
   */
  authorRef: z.string().nullable(),
  /**
   * Plain-language caveats shown in the UI next to the signal. Populated by the
   * collector so the interface cannot silently drop them.
   */
  limitations: z.array(z.string()),
});

export type Signal = z.infer<typeof SignalSchema>;
export type SignalLocation = z.infer<typeof SignalLocationSchema>;
export type HazardType = z.infer<typeof HazardTypeSchema>;
