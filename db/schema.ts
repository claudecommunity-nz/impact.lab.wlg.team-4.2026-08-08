import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Embedding, ProjectionModelPayload, Verification } from "./vocabulary";

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
  },
  (t) => [
    index("signals_occurred_at_idx").on(t.occurredAt),
    index("signals_ingested_at_idx").on(t.ingestedAt),
    // Dedupe lookup: source + text + occurred_at.
    index("signals_dedupe_idx").on(t.source, t.occurredAt),
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
    /** Ranking score for the queue. */
    score: real("score").notNull().default(0),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("groups_level_idx").on(t.level),
    index("groups_last_seen_idx").on(t.lastSeen),
    index("groups_score_idx").on(t.score),
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
