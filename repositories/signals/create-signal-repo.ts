import { and, eq, isNull, sql } from "drizzle-orm";
import { annotations, signals, type Db } from "@/db";
import { type Annotation } from "@/repositories/annotations/annotation-schema";
import { type Signal } from "./signal-schema";

/** The handle inside `db.transaction` — the re-select must run on it, not on `db`. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Writes a signal and its annotations atomically — a signal that lost its feed
 * annotations halfway through would be a silent data-quality lie.
 *
 * The insert is `ON CONFLICT DO NOTHING` against the two partial unique indexes
 * of convergence Decision 4, which is what makes dedupe true under CONCURRENCY
 * rather than only in sequence: ten simultaneous deliveries of the same report
 * all attempt the insert, the database keeps exactly one, and the nine losers
 * re-read the winner's row and report `created: false`. Without it the
 * SELECT-then-INSERT in ingest is a race that inflates a cluster's mass.
 *
 * Which index caught it decides how we re-read the winner — see `reselect`.
 */
export async function createSignalRepo(args: {
  db: Db;
  signal: {
    source: string;
    sourceClass: string;
    text: string;
    raw: unknown;
    occurredAt: Date;
    lat?: number | null;
    lng?: number | null;
    geoConfidence?: number | null;
    datasetId: string;
    externalId?: string | null;
    author?: string | null;
    url?: string | null;
    quotedUrls?: string[] | null;
    synthetic?: boolean;
  };
  annotations: {
    key: string;
    value: string;
    confidence?: number | null;
    annotator: string;
  }[];
}): Promise<{ signal: Signal; annotations: Annotation[]; created: boolean }> {
  return args.db.transaction(async (tx) => {
    const [signal] = await tx
      .insert(signals)
      .values({
        source: args.signal.source,
        sourceClass: args.signal.sourceClass,
        text: args.signal.text,
        raw: args.signal.raw,
        occurredAt: args.signal.occurredAt,
        lat: args.signal.lat ?? null,
        lng: args.signal.lng ?? null,
        geoConfidence: args.signal.geoConfidence ?? null,
        datasetId: args.signal.datasetId,
        externalId: args.signal.externalId ?? null,
        author: args.signal.author ?? null,
        url: args.signal.url ?? null,
        quotedUrls: args.signal.quotedUrls ?? null,
        synthetic: args.signal.synthetic ?? false,
      })
      .onConflictDoNothing()
      .returning();

    // No row back = a unique index refused a duplicate. Someone else stored this
    // exact observation; re-read theirs and write no annotations, or we would
    // double every finding on the signal they already own.
    if (!signal) {
      const existing = await reselect(tx, args.signal);
      if (!existing) throw new Error("Signal insert conflicted but the conflicting row is gone");
      return { signal: existing, annotations: [], created: false };
    }

    if (args.annotations.length === 0) return { signal: signal as Signal, annotations: [], created: true };

    const rows = await tx
      .insert(annotations)
      .values(
        args.annotations.map((a) => ({
          nodeId: signal.id,
          key: a.key,
          value: a.value,
          confidence: a.confidence ?? null,
          annotator: a.annotator,
        })),
      )
      .returning();

    return { signal: signal as Signal, annotations: rows, created: true };
  });
}

/**
 * Re-read the row that won the race, by the SAME key the index used.
 *
 * The two paths are not interchangeable. With an `external_id` the collector's
 * id is identity, and the stored text may legitimately differ from ours (a
 * headline edited between two polls) — matching on text would find nothing and
 * we would report a phantom failure. Without one, the text IS the identity.
 */
async function reselect(
  tx: Tx,
  signal: { datasetId: string; source: string; externalId?: string | null; text: string; occurredAt: Date },
): Promise<Signal | null> {
  const [row] = await tx
    .select()
    .from(signals)
    .where(
      signal.externalId
        ? and(
            eq(signals.datasetId, signal.datasetId),
            eq(signals.source, signal.source),
            eq(signals.externalId, signal.externalId),
          )
        : and(
            eq(signals.datasetId, signal.datasetId),
            eq(signals.source, signal.source),
            isNull(signals.externalId),
            sql`md5(${signals.text}) = md5(${signal.text})`,
            eq(signals.occurredAt, signal.occurredAt),
          ),
    )
    .limit(1);
  return (row as Signal | undefined) ?? null;
}
