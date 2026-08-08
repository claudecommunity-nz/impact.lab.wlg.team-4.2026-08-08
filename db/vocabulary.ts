import { z } from "zod";

/**
 * The shared vocabulary + the zod contracts for every jsonb column.
 *
 * Zod is the source of truth here: `db/schema.ts` types its jsonb columns from
 * these, repositories re-use them in their entity schemas, and the ingest
 * boundary validates against them. This file has NO runtime dependency beyond
 * zod, so any layer (repos, use cases, workflows, adapters) may import it.
 *
 * CONVENTIONS, NOT CONSTRAINTS. The suggestion lists below are documentation
 * for humans and prompts — they are never enforced as enums on stored data.
 * An unknown `source_class`, an invented annotation key or a new edge rel must
 * always be accepted; that is how one schema absorbs sources nobody has met yet.
 */

// ─── source_class ─────────────────────────────────────────────────────────────
//
// OPEN TEXT. Suggested values only. Source diversity = COUNT(DISTINCT source_class)
// across a group's members, so consistency helps, but novelty must never fail.
export const SOURCE_CLASS_SUGGESTIONS = [
  "human_report",
  "official_feed",
  "sensor",
  "media",
  "social",
  "operator_note",
] as const;

/** Used when a payload carries no recognisable source_class. */
export const UNKNOWN_SOURCE_CLASS = "unknown";
/** Used when a payload carries no recognisable source. */
export const UNKNOWN_SOURCE = "unknown";

// ─── annotators ───────────────────────────────────────────────────────────────
//
// Who asserted an annotation. Written by us, never by callers, so this list is
// closed in practice — but entity schemas still read it as free text.
export const ANNOTATORS = ["claude", "feed", "rule", "operator"] as const;
export type Annotator = (typeof ANNOTATORS)[number];

// ─── edge rels ────────────────────────────────────────────────────────────────
export const EDGE_RELS = ["member_of", "duplicate_of", "corroborates", "contradicts"] as const;
export type EdgeRel = (typeof EDGE_RELS)[number];

/** The one rel with a structural rule: a node belongs to at most one group. */
export const MEMBER_OF: EdgeRel = "member_of";

// ─── annotation keys ──────────────────────────────────────────────────────────
//
// Seed vocabulary. Feeds are encouraged to use these; anything else is kept and
// displayed, it just isn't promoted into ranking.
export const ANNOTATION_KEY_SUGGESTIONS = [
  "verified",
  "confidence",
  "source_url",
  "hazard",
  "location_text",
  "severity",
  "urgency",
  "people_count",
] as const;

/** Written by the ingest rule when occurred_at was absent and defaulted to now. */
export const ASSUMED_OCCURRED_AT_KEY = "assumed_occurred_at";

/**
 * The item's own link. It is BOTH a column (origin fingerprinting joins on it)
 * and an annotation (other teams already read it there). Duplicated on purpose:
 * a published key is a promise, and tidiness is not a reason to break one.
 */
export const SOURCE_URL_KEY = "source_url";

/** Marks an item authored for a demo or a drill, so provenance can always say so. */
export const SYNTHETIC_KEY = "synthetic";

/** Which embedder placed this item — a lexical stub and a real model are not one claim. */
export const EMBEDDING_MODEL_KEY = "embedding_model";

/** Written when the derived sentence hit MAX_TEXT_LENGTH — `raw` still has it all. */
export const TEXT_TRUNCATED_KEY = "text_truncated";

/**
 * Written when coordinates were present but outside WGS84 range, so they were
 * NOT stored as lat/lng. The values survive in `raw`; this says we refused them.
 */
export const GEO_DROPPED_KEY = "geo_dropped";

/**
 * Written when NUL bytes (U+0000) were removed from the payload. Postgres
 * `text` and `jsonb` both reject U+0000 outright, so keeping it would mean
 * failing the whole item; we remove it (replacing with nothing) and say so.
 */
export const NUL_BYTES_STRIPPED_KEY = "nul_bytes_stripped";

/** Annotation values are text; absurd payload values are truncated, not dropped. */
export const MAX_ANNOTATION_VALUE_LENGTH = 2000;

/** The stored sentence is capped; the overflow lives on in `raw`, never lost. */
export const MAX_TEXT_LENGTH = 4000;

// ─── jsonb contracts ──────────────────────────────────────────────────────────

/** signals.raw — the source payload, kept verbatim, forever. Any JSON shape. */
export const RawPayloadSchema = z.unknown();
export type RawPayload = z.infer<typeof RawPayloadSchema>;

/** signals.embedding / groups.centroid_embedding — no pgvector; plain number[]. */
export const EmbeddingSchema = z.array(z.number());
export type Embedding = z.infer<typeof EmbeddingSchema>;

/**
 * groups.verification — the reliability picture for a bubble. Loose on purpose:
 * later phases add fields without a migration, and nothing here is presented as
 * confirmed fact.
 */
export const VerificationSchema = z.looseObject({
  status: z.string().optional(),
  distinctSources: z.number().int().optional(),
  distinctSourceClasses: z.number().int().optional(),
  corroborations: z.number().int().optional(),
  contradictions: z.number().int().optional(),
  notes: z.string().optional(),
  /** Members carrying a truthy `verified` annotation — never "this is true". */
  verifiedCount: z.number().int().optional(),
  /** Mean of members' `confidence` annotations, when any were supplied. */
  meanConfidence: z.number().nullable().optional(),
  /** The distinct source_class values behind the bubble, for the diversity axis. */
  sourceClasses: z.array(z.string()).optional(),
  /** How `groups.score` was arrived at, in words — a rank nobody can read is a rank nobody trusts. */
  scoreBreakdown: z.string().optional(),
});
export type Verification = z.infer<typeof VerificationSchema>;

/** The annotation keys the verification fold reads. Absent = simply not asserted. */
export const VERIFIED_KEY = "verified";
export const CONFIDENCE_KEY = "confidence";
/** Values counted as an assertion of verification (case-insensitive). */
export const VERIFIED_TRUE_VALUES = ["true", "yes", "1", "confirmed", "verified"] as const;

// ─── datasets ─────────────────────────────────────────────────────────────────
//
// A dataset NAMESPACES everything: items, clusters and grade events all carry
// one, and clustering never crosses datasets. `live` is the real world; a
// replay, a drill or a fixture set gets its own name, so a demo can never leak
// fabricated corroboration into the operational picture.

/** The default namespace — what an item with no `datasetId` belongs to. */
export const DATASET_LIVE = "live";

// ─── the Admiralty grade ──────────────────────────────────────────────────────
//
// Two independent axes, never blended into one number. A single percentage is
// false precision and is explicitly rejected: an operator must be able to see
// "a reliable source said something we cannot corroborate" as a DIFFERENT state
// from "an unknown source said something three others confirm".

/** Source reliability A (completely reliable) → F (cannot be judged). */
export const SOURCE_RELIABILITY = ["A", "B", "C", "D", "E", "F"] as const;
export type SourceReliability = (typeof SOURCE_RELIABILITY)[number];

/**
 * A source we have never met is F — "reliability cannot be judged" — never a
 * middle grade. Absence of evidence about a source is not evidence of mediocrity.
 */
export const DEFAULT_SOURCE_RELIABILITY: SourceReliability = "F";

/**
 * Information credibility 1–6. **1 is unreachable by code**: "confirmed by other
 * sources" is a human's word, not a machine's, so the grading module throws
 * rather than ever writing it, and `groups.confirmed_by` is only ever set by a
 * person.
 */
export const INFO_CREDIBILITY_LABELS: Record<number, string> = {
  1: "confirmed by other sources",
  2: "probably true",
  3: "possibly true",
  4: "doubtful",
  5: "improbable",
  6: "truth cannot be judged",
};

export const SOURCE_RELIABILITY_LABELS: Record<SourceReliability, string> = {
  A: "completely reliable",
  B: "usually reliable",
  C: "fairly reliable",
  D: "not usually reliable",
  E: "unreliable",
  F: "reliability cannot be judged",
};

/** The one place a grade becomes a sentence — "C3 — fairly reliable / possibly true". */
export function renderGradeLabel(reliability: SourceReliability, credibility: number): string {
  return `${reliability}${credibility} — ${SOURCE_RELIABILITY_LABELS[reliability]} / ${
    INFO_CREDIBILITY_LABELS[credibility] ?? "unknown credibility"
  }`;
}

/** groups.grade / grade_events.to_grade — the published verdict, never a score. */
export const GradeSchema = z.object({
  sourceReliability: z.enum(SOURCE_RELIABILITY),
  /** 1–6. 1 is never machine-written. */
  infoCredibility: z.number().int().min(1).max(6),
  /** Both axes rendered together for a human. */
  label: z.string(),
});
export type Grade = z.infer<typeof GradeSchema>;

/** groups.reasons / grade_events.reasons — ordered, most decisive first. */
export const ReasonsSchema = z.array(z.string());

/** The reason the phase-A placeholder grader writes, so nobody mistakes it for the rule table. */
export const GRADING_STUB_REASON = "stub: grading module pending";

/** projection_models.model — kind-specific fitted parameters (e.g. PCA basis). */
export const ProjectionModelPayloadSchema = z.record(z.string(), z.unknown());
export type ProjectionModelPayload = z.infer<typeof ProjectionModelPayloadSchema>;

/** projection_models.kind — one fitted reference model per kind. */
export const PROJECTION_KINDS = ["pca3"] as const;

/** The galaxy's basis: fitted once, then every point forever transforms through it. */
export const PCA3: (typeof PROJECTION_KINDS)[number] = "pca3";

/**
 * The stored PCA basis — deliberately just numbers, not an ml-pca model dump.
 * Anyone (a notebook, another team, a later rewrite) can reproduce a coordinate
 * with `dot(embedding - mean, components[i])`; nothing here needs our library.
 */
export const Pca3ModelSchema = z.object({
  mean: z.array(z.number()),
  /** Exactly three unit rows of `mean.length` — x, y, z. */
  components: z.array(z.array(z.number())).length(3),
  /** How much of the spread each axis carries — honesty about a 1536→3 squash. */
  explainedVariance: z.array(z.number()).length(3),
  /** How many signals the basis was fitted on. Never refitted (stability rule). */
  fittedOn: z.number().int(),
  dimensions: z.number().int(),
});
export type Pca3Model = z.infer<typeof Pca3ModelSchema>;

// ─── the ingest contract ──────────────────────────────────────────────────────
//
// What an adapter produces and the ingest use case consumes. Adapters absorb the
// entire shape burden of the outside world: everything below is already clean.

export const IncomingAnnotationSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  annotator: z.string().min(1).default("feed"),
});
export type IncomingAnnotation = z.infer<typeof IncomingAnnotationSchema>;

export const IncomingSignalSchema = z.object({
  /** Where it came from, e.g. "wcc-hilltop", "@user", "police-media". */
  source: z.string().min(1),
  /** OPEN TEXT — see SOURCE_CLASS_SUGGESTIONS. */
  sourceClass: z.string().min(1),
  /** The honest sentence. Text is the universal interface. */
  text: z.string().min(1),
  /** Namespace: live vs replay vs fixtures. Clustering never crosses datasets. */
  datasetId: z.string().min(1).default(DATASET_LIVE),
  /** The collector's own stable id for this item — the strong dedupe key. */
  externalId: z.string().min(1).optional(),
  /** Who wrote it, if the source distinguishes accounts (origin fingerprinting). */
  author: z.string().min(1).optional(),
  /** Canonical link to the item itself — what another item's `quotedUrls` points at. */
  url: z.string().min(1).optional(),
  /** Links this item quotes/retweets — how a repost inherits an origin. */
  quotedUrls: z.array(z.string().min(1)).default([]),
  /** Authored for a demo or a drill. Carried to every provenance entry, always. */
  synthetic: z.boolean().default(false),
  /** Optional: defaults to now at ingest, with an assumed_occurred_at annotation. */
  occurredAt: z.date().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  geoConfidence: z.number().min(0).max(1).optional(),
  /** The original payload, untouched. */
  raw: RawPayloadSchema,
  annotations: z.array(IncomingAnnotationSchema).default([]),
});
export type IncomingSignal = z.infer<typeof IncomingSignalSchema>;
