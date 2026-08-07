import {
  IncomingSignalSchema,
  MAX_ANNOTATION_VALUE_LENGTH,
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
 * verbatim in `raw`. Nothing is discarded and nothing is required except a
 * sentence we can derive — `{"text": "..."}` is a complete payload.
 *
 * Only when no text can be derived at all does it decline, with a reason the
 * sender can act on.
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
/** Nested objects whose scalars are promoted as annotations (GeoJSON `properties`, …). */
const ANNOTATION_CONTAINER_KEYS = ["meta", "metadata", "properties", "attributes", "fields"];

const MAX_TEXT_LENGTH = 4000;

type Dict = Record<string, unknown>;

export function genericJsonAdapter(payload: unknown): AdapterResult {
  try {
    return adapt(payload);
  } catch (err) {
    // Belt and braces: an adapter that throws would sink a whole batch.
    return { ok: false, reason: `Adapter failed to read payload: ${String(err)}` };
  }
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

  const derived = input.text ?? deriveText(obj, consumed);
  if (derived === null) {
    return {
      ok: false,
      reason:
        "Could not derive any text from the payload — send a `text` field, or any readable scalar value",
    };
  }

  const annotations = collectAnnotations(obj, consumed);

  const text = derived.length > MAX_TEXT_LENGTH ? `${derived.slice(0, MAX_TEXT_LENGTH)}…` : derived;
  if (text !== derived) {
    annotations.push({ key: "text_truncated", value: "true", annotator: "feed" });
  }

  const parsed = IncomingSignalSchema.safeParse({
    source,
    sourceClass,
    text,
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

function takeGeo(
  obj: Dict,
  consumed: Set<string>,
): { lat?: number; lng?: number; confidence?: number } {
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
  if (lat === undefined || lng === undefined) return {};
  if (!inRange(lat, -90, 90) || !inRange(lng, -180, 180)) return {};

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
