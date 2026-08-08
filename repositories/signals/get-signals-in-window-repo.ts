import { and, asc, eq, gte, lte } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/**
 * The galaxy's population for a time window, on the `occurred_at` clock (when
 * the thing happened) rather than `ingested_at` (when we heard about it) —
 * replaying a dataset and living through it must produce the same picture.
 *
 * Ordered oldest-first and tie-broken deterministically so two calls with the
 * same window return the same array in the same order.
 *
 * `datasetId` is optional because this read has two honest callers: a board
 * scoped to one namespace, and a maintenance sweep that legitimately wants
 * everything. Absent means everything — but a UI that shows a dataset MUST
 * pass it, or a drill's clusters appear beside the operational picture.
 */
export async function getSignalsInWindowRepo(args: {
  db: Db;
  from: Date;
  to: Date;
  limit: number;
  datasetId?: string;
}): Promise<Signal[]> {
  return args.db
    .select()
    .from(signals)
    .where(
      and(
        gte(signals.occurredAt, args.from),
        lte(signals.occurredAt, args.to),
        args.datasetId ? eq(signals.datasetId, args.datasetId) : undefined,
      ),
    )
    .orderBy(asc(signals.occurredAt), asc(signals.id))
    .limit(args.limit);
}
