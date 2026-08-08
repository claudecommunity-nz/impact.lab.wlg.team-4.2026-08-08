import {
  DATASET_LIVE,
  GEO_DROPPED_KEY,
  IncomingSignalSchema,
  SOURCE_URL_KEY,
  SYNTHETIC_KEY,
  MAX_ANNOTATION_VALUE_LENGTH,
  MAX_TEXT_LENGTH,
  NUL_BYTES_STRIPPED_KEY,
  TEXT_TRUNCATED_KEY,
  UNKNOWN_SOURCE,
  UNKNOWN_SOURCE_CLASS,
  type IncomingAnnotation,
} from "@/db/vocabulary";
import type { AdapterResult } from "./adapter-types";

/**
 * The universal adapter: accepts ANY JSON payload and never throws.
 *
 * Other teams should not have to learn our schema to send us something. So:
 * recognised keys map onto the signal's core fields, every other top-level
 * scalar is promoted to a `feed` annotation, and the whole payload is kept
 * verbatim in `raw`. Nothing is required except a sentence we can derive —
 * `{"text": "..."}` is a complete payload.
 *
 * Two edits are made to what is stored, and BOTH are annotated rather than
 * silent, because a doc that says "nothing is discarded" must be literally true:
 * the derived sentence is capped at MAX_TEXT_LENGTH (`text_truncated`), and NUL
 * bytes are removed (`nul_bytes_stripped`) since Postgres can hold them in
 * neither `text` nor `jsonb`. The full original survives in `raw` either way.
 *
 * Two things make it decline: no derivable text (including a blank or
 * whitespace-only sentence), and a payload that is not an object or a string.
 * Everything else degrades — unusable coordinates are annotated (`geo_dropped`)
 * and the signal still lands.
 */

// Recognised key aliases. First match wins; a key consumed here is NOT repeated
// as an annotation (it already became a column, and `raw` still has it).
const TEXT_KEYS = ["text", "content", "body", "message", "description", "summary", "report", "note"];
// `name` is deliberately absent: it is far more often a station or a person
// than a headline, and it reads better as an annotation.
const TITLE_KEYS = ["title", "headline", "subject"];
const SOURCE_KEYS = [
  "source",
  "source_name",
  "sourceName",
  "feed",
  "origin",
  "publisher",
  "channel",
  "account",
  "author",
];
// Deliberately narrow: `type`/`category`/`kind` usually describe the EVENT, not
// the source, and mis-promoting them would poison source-diversity counts.
const SOURCE_CLASS_KEYS = ["source_class", "sourceClass", "source_type", "sourceType"];
const TIME_KEYS = [
  "occurred_at",
  "occurredAt",
  "observed_at",
  "observedAt",
  "timestamp",
  "datetime",
  "time",
  "date",
  "published_at",
  "publishedAt",
  "created_at",
  "createdAt",
];
const LAT_KEYS = ["lat", "latitude"];
const LNG_KEYS = ["lng", "lon", "long", "longitude"];
const GEO_CONFIDENCE_KEYS = ["geo_confidence", "geoConfidence"];
const GEO_CONTAINER_KEYS = ["location", "geo", "position", "point", "geometry", "coordinates"];

// ─── the identity fields (convergence Decision 2) ─────────────────────────────
//
// All optional, like everything else. Sending them buys better dedupe and, once
// origin fingerprinting lands, an honest independent-source count; omitting
// them costs nothing but precision.
const DATASET_KEYS = ["dataset_id", "datasetId", "dataset"];
/** A collector's own id. `id`/`guid` last: many payloads use them for other things. */
const EXTERNAL_ID_KEYS = ["external_id", "externalId", "item_id", "itemId", "guid", "id"];
/**
 * Deliberately NOT overlapping SOURCE_KEYS' `author`: whichever of the two runs
 * first consumes it. `source` runs first, so a payload with only `author` names
 * its source after the author — which is right for a social post, where the
 * account IS the source.
 */
const AUTHOR_KEYS = ["author", "username", "screen_name", "screenName", "byline", "user"];
const URL_KEYS = ["url", "link", "permalink", "source_url", "sourceUrl"];
const QUOTED_URL_KEYS = ["quoted_urls", "quotedUrls", "quoted_url", "quotedUrl", "in_reply_to_url"];
const SYNTHETIC_KEYS = ["synthetic", "is_synthetic", "isSynthetic", "fixture"];
/** Nested objects whose scalars are promoted as annotations (GeoJSON `properties`, …). */
const ANNOTATION_CONTAINER_KEYS = ["meta", "metadata", "properties", "attributes", "fields"];

type Dict = Record<string, unknown>;

export function genericJsonAdapter(payload: unknown): AdapterResult {
  try {
    // Postgres `text` AND `jsonb` both reject U+0000 outright, so a single NUL
    // anywhere in a payload would otherwise fail the whole item at write time —
    // and scraped social/news text really does carry control characters. We
    // remove them (substituted with nothing) BEFORE anything reads the payload,
    // so `raw`, the sentence and every annotation are all consistently clean,
    // and we SAY SO with an annotation rather than quietly editing your data.
    const cleaned = stripNulBytes(payload);
    const result = adapt(cleaned.value);
    if (result.ok && cleaned.stripped) {
      result.signal.annotations.push({
        key: NUL_BYTES_STRIPPED_KEY,
        value: "true",
        annotator: "rule",
      });
    }
    return result;
  } catch (err) {
    // Belt and braces: an adapter that throws would sink a whole batch.
    return { ok: false, reason: `Adapter failed to read payload: ${String(err)}` };
  }
}

/** The one character Postgres cannot store in `text` or `jsonb`. */
const NUL = "\u0000";

/** Deep copy with every U+0000 removed — from object keys and string values alike. */
function stripNulBytes(value: unknown): { value: unknown; stripped: boolean } {
  let stripped = false;

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (!node.includes(NUL)) return node;
      stripped = true;
      return node.split(NUL).join("");
    }
    if (Array.isArray(node)) return node.map(walk);
    if (isDict(node)) {
      const out: Dict = {};
      for (const [key, child] of Object.entries(node)) {
        out[walk(key) as string] = walk(child);
      }
      return out;
    }
    return node;
  };

  return { value: walk(value), stripped };
}

function adapt(payload: unknown): AdapterResult {
  // A bare string is a perfectly good report — treat it as the sentence.
  if (typeof payload === "string") {
    const text = payload.trim();
    if (text.length === 0) return { ok: false, reason: "Payload was an empty string" };
    return build({ text, raw: payload, consumed: new Set(), obj: {} });
  }

  if (!isDict(payload)) {
    return {
      ok: false,
      reason: `Payload must be a JSON object or string, received ${describe(payload)}`,
    };
  }

  // GeoJSON features, feed envelopes and scraper output all hide the good stuff
  // one level down in a property bag. Lift those scalars into the working view
  // (top level always wins) so a Feature reads as well as a flat object.
  return build({ text: null, raw: payload, consumed: new Set(), obj: flattenContainers(payload) });
}

function flattenContainers(obj: Dict): Dict {
  const lifted: Dict = {};
  for (const key of ANNOTATION_CONTAINER_KEYS) {
    const container = obj[key];
    if (!isDict(container)) continue;
    for (const [k, v] of Object.entries(container)) {
      if (!(k in lifted)) lifted[k] = v;
    }
  }
  return Object.keys(lifted).length === 0 ? obj : { ...lifted, ...obj };
}

function build(input: {
  text: string | null;
  raw: unknown;
  consumed: Set<string>;
  obj: Dict;
}): AdapterResult {
  const { obj, consumed } = input;

  // Core fields FIRST: they consume their keys, so the sentence we render below
  // never repeats plumbing ("source: hilltop; timestamp: …") back at the reader.
  const source = takeString(obj, SOURCE_KEYS, consumed) ?? UNKNOWN_SOURCE;
  const sourceClass = takeString(obj, SOURCE_CLASS_KEYS, consumed) ?? UNKNOWN_SOURCE_CLASS;
  const occurredAt = takeDate(obj, TIME_KEYS, consumed);
  const geo = takeGeo(obj, consumed);

  // The identity fields. All optional; each one bought, not required.
  const datasetId = takeString(obj, DATASET_KEYS, consumed) ?? DATASET_LIVE;
  const externalId = takeString(obj, EXTERNAL_ID_KEYS, consumed);
  const author = takeString(obj, AUTHOR_KEYS, consumed);
  const url = takeString(obj, URL_KEYS, consumed);
  const quotedUrls = takeStringArray(obj, QUOTED_URL_KEYS, consumed);
  const synthetic = takeBoolean(obj, SYNTHETIC_KEYS, consumed) ?? false;

  // A blank sentence is worse than no sentence: it embeds, groups and shows up
  // on the board saying nothing. `{"text":"   "}` is a rejected item, not a
  // signal — and the reason tells the sender exactly what to send instead.
  const derived = input.text ?? deriveText(obj, consumed);
  if (derived === null || derived.trim().length === 0) {
    return {
      ok: false,
      reason:
        "Could not derive any text from the payload — send a `text` field, or any readable scalar value",
    };
  }

  const annotations = collectAnnotations(obj, consumed);

  const text = derived.length > MAX_TEXT_LENGTH ? `${derived.slice(0, MAX_TEXT_LENGTH)}…` : derived;
  if (text !== derived) {
    annotations.push({ key: TEXT_TRUNCATED_KEY, value: "true", annotator: "feed" });
  }

  // Coordinates we refused are worth MORE than silence: the sender needs to know
  // their geo did not land, and the board needs to know this signal is
  // ungeolocated for a reason. The values themselves still live in `raw`.
  if (geo.dropped) {
    annotations.push({ key: GEO_DROPPED_KEY, value: geo.dropped, annotator: "rule" });
  }

  // The item's own link became a COLUMN above, which would have quietly removed
  // `source_url` from the annotations other teams already read. It is worth
  // having in both places — a column origin fingerprinting can join on, and the
  // annotation that was published first — so we put it back rather than break
  // a contract for the sake of tidiness.
  if (url !== undefined && !annotations.some((a) => a.key === SOURCE_URL_KEY)) {
    annotations.push({ key: SOURCE_URL_KEY, value: truncate(url), annotator: "feed" });
  }
  if (synthetic) {
    annotations.push({ key: SYNTHETIC_KEY, value: "true", annotator: "feed" });
  }

  const parsed = IncomingSignalSchema.safeParse({
    source,
    sourceClass,
    text,
    datasetId,
    externalId,
    author,
    url,
    quotedUrls,
    synthetic,
    occurredAt,
    lat: geo.lat,
    lng: geo.lng,
    geoConfidence: geo.confidence,
    raw: input.raw,
    annotations,
  });

  if (!parsed.success) {
    return { ok: false, reason: `Adapted payload failed validation: ${parsed.error.message}` };
  }
  return { ok: true, signal: parsed.data };
}

// ─── text ─────────────────────────────────────────────────────────────────────

function deriveText(obj: Dict, consumed: Set<string>): string | null {
  const title = takeString(obj, TITLE_KEYS, consumed);
  const body = takeString(obj, TEXT_KEYS, consumed);

  // A headline plus a body reads better as one honest sentence than either alone.
  if (title && body) return `${stripTrailingPunctuation(title)} — ${body}`;
  if (body) return body;
  if (title) return title;

  // Nothing recognisable: render the payload's own scalars as a sentence, so a
  // sensor row like {station, stage_m, trend} still becomes readable text.
  const rendered = Object.entries(obj)
    .filter(([k, v]) => !consumed.has(k) && isScalar(v))
    // An empty value renders as "text: " — a junk sentence about to be embedded.
    .filter(([, v]) => scalarToString(v).length > 0)
    .map(([k, v]) => `${humanise(k)}: ${scalarToString(v)}`)
    .join("; ");

  return rendered.length > 0 ? rendered : null;
}

// ─── field extraction ─────────────────────────────────────────────────────────

function takeString(obj: Dict, keys: string[], consumed: Set<string>): string | undefined {
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      consumed.add(key);
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      consumed.add(key);
      return String(value);
    }
  }
  return undefined;
}

/** `true`/`false`, and the strings and 1/0 that mean them in half the feeds alive. */
function takeBoolean(obj: Dict, keys: string[], consumed: Set<string>): boolean | undefined {
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const value = obj[key];
    if (typeof value === "boolean") {
      consumed.add(key);
      return value;
    }
    if (typeof value === "string" && ["true", "false", "1", "0"].includes(value.trim().toLowerCase())) {
      consumed.add(key);
      return ["true", "1"].includes(value.trim().toLowerCase());
    }
    if (value === 1 || value === 0) {
      consumed.add(key);
      return value === 1;
    }
  }
  return undefined;
}

/** An array of links, or a single link — senders write both and mean the same thing. */
function takeStringArray(obj: Dict, keys: string[], consumed: Set<string>): string[] {
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const value = obj[key];
    if (Array.isArray(value)) {
      consumed.add(key);
      return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
    }
    if (typeof value === "string" && value.trim().length > 0) {
      consumed.add(key);
      return [value.trim()];
    }
  }
  return [];
}

function takeDate(obj: Dict, keys: string[], consumed: Set<string>): Date | undefined {
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const parsed = toDate(obj[key]);
    if (parsed) {
      consumed.add(key);
      return parsed;
    }
  }
  return undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "number") {
    // Epoch seconds or milliseconds — anything smaller is not a timestamp.
    const ms = value > 1e11 ? value : value > 1e9 ? value * 1000 : NaN;
    return isNaN(ms) ? undefined : new Date(ms);
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return isNaN(ms) ? undefined : new Date(ms);
  }
  return undefined;
}

/**
 * `dropped` is set when coordinates WERE present but were not usable — the one
 * geo outcome the sender must hear about, since an absent lat/lng and a refused
 * lat/lng look identical from the outside.
 */
function takeGeo(
  obj: Dict,
  consumed: Set<string>,
): { lat?: number; lng?: number; confidence?: number; dropped?: string } {
  let lat = takeNumber(obj, LAT_KEYS, consumed);
  let lng = takeNumber(obj, LNG_KEYS, consumed);

  if (lat === undefined || lng === undefined) {
    for (const key of GEO_CONTAINER_KEYS) {
      if (consumed.has(key)) continue;
      const found = readGeoContainer(obj[key]);
      if (found) {
        lat = found.lat;
        lng = found.lng;
        consumed.add(key);
        break;
      }
    }
  }

  const confidence = takeNumber(obj, GEO_CONFIDENCE_KEYS, consumed);
  if (lat === undefined || lng === undefined) {
    // Half a coordinate is not a location, and guessing the other half would be
    // inventing geography. Say we dropped it rather than pretending it never came.
    if (lat === undefined && lng === undefined) return {};
    return { dropped: `incomplete coordinates (lat=${lat ?? "absent"}, lng=${lng ?? "absent"})` };
  }
  if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180)) {
    return { dropped: `coordinates out of range (lat=${lat}, lng=${lng})` };
  }

  // An explicit coordinate from the source is as certain as geo gets; anything
  // inferred later (by a geocoder) writes its own, lower, confidence.
  return { lat, lng, confidence: confidence ?? 1 };
}

function readGeoContainer(value: unknown): { lat: number; lng: number } | null {
  // GeoJSON position: [lng, lat].
  if (Array.isArray(value) && value.length >= 2) {
    const [lng, lat] = value;
    if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
    return null;
  }
  if (!isDict(value)) return null;

  // GeoJSON geometry: { type: "Point", coordinates: [lng, lat] }.
  if (Array.isArray(value.coordinates)) return readGeoContainer(value.coordinates);

  const lat = firstNumber(value, LAT_KEYS);
  const lng = firstNumber(value, LNG_KEYS);
  if (lat === undefined || lng === undefined) return null;
  return { lat, lng };
}

function takeNumber(obj: Dict, keys: string[], consumed: Set<string>): number | undefined {
  for (const key of keys) {
    if (consumed.has(key)) continue;
    const n = toNumber(obj[key]);
    if (n !== undefined) {
      consumed.add(key);
      return n;
    }
  }
  return undefined;
}

function firstNumber(obj: Dict, keys: string[]): number | undefined {
  for (const key of keys) {
    const n = toNumber(obj[key]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// ─── annotations ──────────────────────────────────────────────────────────────

/**
 * Everything the payload knows that did not become a column. Explicit
 * annotations first, then nested property bags, then every leftover top-level
 * scalar. Unknown keys are kept — conventions, not constraints.
 */
function collectAnnotations(obj: Dict, consumed: Set<string>): IncomingAnnotation[] {
  const out: IncomingAnnotation[] = [];

  const explicit = obj["annotations"];
  if (explicit !== undefined) {
    consumed.add("annotations");
    out.push(...readExplicitAnnotations(explicit));
  }

  const tags = obj["tags"];
  if (tags !== undefined) {
    consumed.add("tags");
    if (Array.isArray(tags)) {
      for (const tag of tags) if (isScalar(tag)) out.push(annotation("tag", scalarToString(tag)));
    } else if (isDict(tags)) {
      out.push(...promoteScalars(tags));
    } else if (isScalar(tags)) {
      out.push(annotation("tag", scalarToString(tags)));
    }
  }

  // Property bags were already lifted into this view by flattenContainers, so
  // the sweep below covers nested scalars too.
  for (const [key, value] of Object.entries(obj)) {
    if (consumed.has(key)) continue;
    if (!isScalar(value)) continue;
    out.push(annotation(key, scalarToString(value)));
  }

  return out;
}

function readExplicitAnnotations(value: unknown): IncomingAnnotation[] {
  if (Array.isArray(value)) {
    const out: IncomingAnnotation[] = [];
    for (const item of value) {
      if (isDict(item) && typeof item.key === "string" && item.key.trim() !== "") {
        out.push({
          key: item.key.trim(),
          value: truncate(isScalar(item.value) ? scalarToString(item.value) : safeStringify(item.value)),
          confidence: inUnitRange(item.confidence) ? (item.confidence as number) : undefined,
          annotator: typeof item.annotator === "string" && item.annotator ? item.annotator : "feed",
        });
        continue;
      }
      if (isScalar(item)) out.push(annotation("annotation", scalarToString(item)));
    }
    return out;
  }
  if (isDict(value)) return promoteScalars(value);
  if (isScalar(value)) return [annotation("annotation", scalarToString(value))];
  return [];
}

function promoteScalars(obj: Dict): IncomingAnnotation[] {
  return Object.entries(obj)
    .filter(([, v]) => isScalar(v))
    .map(([k, v]) => annotation(k, scalarToString(v)));
}

function annotation(key: string, value: string): IncomingAnnotation {
  return { key, value: truncate(value), annotator: "feed" };
}

// ─── small helpers ────────────────────────────────────────────────────────────

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function scalarToString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string): string {
  return value.length > MAX_ANNOTATION_VALUE_LENGTH
    ? `${value.slice(0, MAX_ANNOTATION_VALUE_LENGTH)}…`
    : value;
}

function humanise(key: string): string {
  return key.replace(/[_-]+/g, " ").trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.:;,\s]+$/, "");
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function inUnitRange(value: unknown): boolean {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
