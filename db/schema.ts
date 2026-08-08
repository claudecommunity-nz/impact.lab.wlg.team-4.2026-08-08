import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  DATASET_LIVE,
  DEFAULT_SOURCE_RELIABILITY,
  type Embedding,
  type Grade,
  type ProjectionModelPayload,
  type Verification,
} from "./vocabulary";

/**
 * Example entity — the reference implementation the docs walk through.
 * Copy this shape (table here → zod schema + queries in repositories/<entity>/)
 * when adding real entities.
 */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * ─── The four nouns ──────────────────────────────────────────────────────────
 *
 * signal · annotation · edge · group (+ a fitted projection model for the galaxy).
 * Columns are earned by system hot paths only; everything else is an annotation.
 * See design/primitives.md and db/vocabulary.ts (zod is the source of truth for
 * every jsonb column).
 */

/**
 * Immutable observation — the ONLY thing ingested, and the end of every
 * traceability chain: `raw` keeps the source payload verbatim, forever.
 */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** When the thing happened (replay + UI clock). Defaulted to now when absent. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /** When we learned about it (bookkeeping clock). */
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    /** OPEN TEXT, never an enum — source diversity counts distinct values. */
    sourceClass: text("source_class").notNull(),
    raw: jsonb("raw").notNull(),
    /** The honest sentence an adapter rendered. Text is the universal interface. */
    text: text("text").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geoConfidence: real("geo_confidence"),
    /** No pgvector: plain number[] in jsonb, similarity computed in-process. */
    embedding: jsonb("embedding").$type<Embedding>(),

    // ─── the namespace and the identity fields ────────────────────────────────
    /**
     * live | replay-… | fixtures-… — the namespace this observation belongs to.
     * Clustering never crosses datasets, so a drill can never corroborate a real
     * event and a demo can never leak fabricated evidence into the live picture.
     */
    datasetId: text("dataset_id").notNull().default(DATASET_LIVE),
    /** The collector's own stable id. Present = the strong dedupe key (D4). */
    externalId: text("external_id"),
    /** Account/byline, where the source distinguishes them — origin fingerprinting. */
    author: text("author"),
    /** Canonical link to this item, so another item quoting it can inherit its origin. */
    url: text("url"),
    /** Links this item quotes or reposts. A repost is not an independent observation. */
    quotedUrls: jsonb("quoted_urls").$type<string[]>(),
    /** Authored for a demo or drill. Carried to every provenance entry, always. */
    synthetic: boolean("synthetic").notNull().default(false),
  },
  (t) => [
    index("signals_occurred_at_idx").on(t.occurredAt),
    index("signals_ingested_at_idx").on(t.ingestedAt),
    index("signals_dataset_id_idx").on(t.datasetId),
    // Dedupe lookup: dataset + source + occurred_at.
    index("signals_dedupe_idx").on(t.datasetId, t.source, t.occurredAt),

    // ─── dedupe, enforced (convergence Decision 4) ────────────────────────────
    //
    // TWO partial unique indexes, because there are two honest answers to "is
    // this the same item?" and neither covers the other:
    //
    //   1. the collector gave it a stable id — then that id IS identity, and
    //      the same story re-titled or re-timed is still one item;
    //   2. it did not — then the only identity we have is what was said, by
    //      whom, when.
    //
    // They are `where`-partitioned on `external_id` so exactly one applies to
    // any row: an item with an id is never also deduped by its text, which
    // would wrongly collapse two genuine updates that happen to read alike.
    //
    // Enforced rather than merely looked up, because SELECT-then-INSERT is a
    // race: ten simultaneous deliveries of one report all miss the select and
    // all insert, inflating a cluster's mass AND its independent-source count —
    // exactly the harm dedupe exists to prevent.
    //
    // md5(text) because `text` runs to 4000 chars and a btree tuple stops at 2704.
    uniqueIndex("signals_external_id_uniq")
      .on(t.datasetId, t.source, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex("signals_text_dedupe_uniq")
      .on(t.datasetId, t.source, sql`md5(${t.text})`, t.occurredAt)
      .where(sql`${t.externalId} is null`),
  ],
);

/**
 * The source registry — who we have met, and how reliable they have proved.
 *
 * Deliberately a TABLE, not a constant: an operator adding "this account has
 * been right all week" is the cheapest real improvement to grading there is,
 * and it must not need a deploy. A source ABSENT from the registry grades F
 * ("reliability cannot be judged") — never a middle grade, because knowing
 * nothing about a source is not the same as knowing it is mediocre.
 */
export const sourceRegistry = pgTable(
  "source_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Matches `signals.source` exactly — the join key, lowercased by convention. */
    sourceId: text("source_id").notNull(),
    name: text("name").notNull(),
    /** A–F. Default F: unknown until shown otherwise. */
    reliability: text("reliability").notNull().default(DEFAULT_SOURCE_RELIABILITY),
    /** official | media | social | sensor | community — open text, like source_class. */
    kind: text("kind").notNull().default("unknown"),
    /** Why this source has this grade, in words. A grade nobody can audit is a guess. */
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("source_registry_source_id_uniq").on(t.sourceId)],
);

/**
 * Every grade transition a cluster has ever made — APPEND ONLY.
 *
 * Never updated, never deleted. Two reasons, both operational: the `asAt` grade
 * is "the last event at or before that instant", so a time-scrubbed map needs
 * the history rather than the current row; and an alert is emitted on a
 * TRANSITION, not on a state, so the thing that fired has to be a record.
 */
export const gradeEvents = pgTable(
  "grade_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The cluster (groups.id) — published as `signalId`. No FK, like every edge here. */
    groupId: uuid("group_id").notNull(),
    datasetId: text("dataset_id").notNull().default(DATASET_LIVE),
    /** null on the first grade a cluster is ever given. */
    fromGrade: jsonb("from_grade").$type<Grade>(),
    toGrade: jsonb("to_grade").$type<Grade>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Distinct origins behind the cluster at this transition — never the item count. */
    independentSources: integer("independent_sources").notNull().default(0),
    itemCount: integer("item_count").notNull().default(0),
    /** The ordered reasons, reproduced verbatim from the grading module. */
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    /** True when this transition raised an alert — alerts are transitions, not states. */
    alertFired: boolean("alert_fired").notNull().default(false),
    alertReasons: jsonb("alert_reasons").$type<string[]>(),
  },
  (t) => [
    index("grade_events_group_id_idx").on(t.groupId),
    index("grade_events_at_idx").on(t.at),
    index("grade_events_dataset_at_idx").on(t.datasetId, t.at),
  ],
);

/**
 * Open assertion about any node (signal or group). Polymorphic by design:
 * node_id carries NO foreign key so annotations survive any node kind.
 */
export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Signal id or group id — deliberately no FK. */
    nodeId: uuid("node_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    confidence: real("confidence"),
    /** claude | feed | rule | operator (see db/vocabulary.ts). */
    annotator: text("annotator").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("annotations_node_id_idx").on(t.nodeId), index("annotations_key_idx").on(t.key)],
);

/**
 * Typed, weighted relationship between any two nodes. Polymorphic like
 * annotations. Every edge carries a human-readable `reason` — a grouping the
 * operator cannot read is a grouping they cannot trust.
 */
export const edges = pgTable(
  "edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromId: uuid("from_id").notNull(),
    toId: uuid("to_id").notNull(),
    /** member_of | duplicate_of | corroborates | contradicts (open text). */
    rel: text("rel").notNull(),
    weight: real("weight"),
    reason: text("reason").notNull(),
    /** claude | rule | operator — who drew the edge. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("edges_from_id_idx").on(t.fromId),
    index("edges_to_id_idx").on(t.toId),
    index("edges_rel_idx").on(t.rel),
    // A node belongs to at most ONE group. Partial: only member_of is exclusive.
    uniqueIndex("edges_one_member_of_per_from")
      .on(t.fromId)
      .where(sql`${t.rel} = 'member_of'`),
  ],
);

/**
 * A bubble, at any depth. Recursive: level 1 groups signals into incidents,
 * level 2 groups groups into themes. Depth IS the kind — no kind column.
 * Hot metrics are cached here; the board never folds at query time.
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    level: integer("level").notNull().default(1),
    centroidEmbedding: jsonb("centroid_embedding").$type<Embedding>(),
    centroidLat: doublePrecision("centroid_lat"),
    centroidLng: doublePrecision("centroid_lng"),
    label: text("label"),
    /** Member count / weight in the window. */
    mass: real("mass").notNull().default(0),
    /** Mass differenced across windows. */
    velocity: real("velocity").notNull().default(0),
    /** COUNT(DISTINCT source_class) across members. */
    sourceDiversity: integer("source_diversity").notNull().default(0),
    verification: jsonb("verification").$type<Verification>(),
    /**
     * INTERNAL ordering key only (convergence Decision 3). Never published: a
     * blended confidence number is exactly the false precision this system
     * exists to refuse. It ranks a queue; it never tells anyone what to believe.
     */
    score: real("score").notNull().default(0),

    // ─── the published verdict ────────────────────────────────────────────────
    /** The namespace this cluster lives in. Clustering never crosses datasets. */
    datasetId: text("dataset_id").notNull().default(DATASET_LIVE),
    /** Admiralty {sourceReliability, infoCredibility, label}. Null before first grading. */
    grade: jsonb("grade").$type<Grade>(),
    /** Ordered, most decisive first — the sentences behind the grade. */
    reasons: jsonb("reasons").$type<string[]>(),
    /**
     * Computed INDEPENDENTLY of the grade. The whole point: in hour zero there
     * are no independent origins yet, so the first report of anything grades
     * badly — and must still wake somebody, WITH its weakness stated.
     */
    alertWorthy: boolean("alert_worthy").notNull().default(false),
    /**
     * A person's name, or null. Never machine-set: "confirmed" (credibility 1)
     * is a human's word. The grading module throws rather than write it.
     */
    confirmedBy: text("confirmed_by"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("groups_level_idx").on(t.level),
    index("groups_last_seen_idx").on(t.lastSeen),
    index("groups_score_idx").on(t.score),
    index("groups_dataset_id_idx").on(t.datasetId),
  ],
);

/**
 * A fitted projection (e.g. PCA basis) for the galaxy view. Fit ONCE and
 * transform new points — refitting per range makes bubbles jump and ranges
 * incomparable. One row per kind.
 */
export const projectionModels = pgTable(
  "projection_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    model: jsonb("model").$type<ProjectionModelPayload>().notNull(),
    fittedAt: timestamp("fitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projection_models_kind_idx").on(t.kind)],
);

/**
 * A signal's position in a fitted projection — the galaxy's coordinates.
 *
 * A separate table, not three columns on `signals`, for three reasons:
 *   1. it is DERIVED, not a fact — `TRUNCATE signal_vectors` rebuilds the whole
 *      galaxy without touching a single immutable observation;
 *   2. it is PLURAL — (signal, kind) is the key, so a second projection
 *      (umap3, a per-hazard basis) coexists with pca3 instead of replacing it;
 *   3. "not yet projected" is then a cheap left-join miss rather than three
 *      nullable hot columns on the table every read touches.
 *
 * Downstream must tolerate a missing row: before the model is fitted, points
 * legitimately have no vec3.
 */
export const signalVectors = pgTable(
  "signal_vectors",
  {
    /** Polymorphic-by-habit like the rest: no FK, so a rebuild order can't deadlock. */
    signalId: uuid("signal_id").notNull(),
    /** Matches projection_models.kind — which fitted basis these coordinates are in. */
    kind: text("kind").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    z: doublePrecision("z").notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.signalId, t.kind] }),
    index("signal_vectors_kind_idx").on(t.kind),
  ],
);
