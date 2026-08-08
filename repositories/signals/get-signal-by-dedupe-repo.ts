import { and, eq, isNull } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/**
 * The cheap read in front of the two unique indexes (convergence Decision 4),
 * asking the same two questions in the same two ways:
 *
 *   1. `external_id` present → (dataset, source, external_id) IS identity. The
 *      collector already told us what "the same item" means; a re-poll that
 *      re-words a headline is still that item.
 *   2. absent → (dataset, source, text, occurred_at) is the only identity we
 *      can construct: what was said, by whom, when.
 *
 * `dataset_id` leads both, so a replay can re-ingest the very same items
 * without colliding with the live picture.
 */
export async function getSignalByDedupeRepo(args: {
  db: Db;
  datasetId: string;
  source: string;
  text: string;
  occurredAt: Date;
  externalId?: string | null;
}): Promise<Signal | null> {
  const [row] = await args.db
    .select()
    .from(signals)
    .where(
      args.externalId
        ? and(
            eq(signals.datasetId, args.datasetId),
            eq(signals.source, args.source),
            eq(signals.externalId, args.externalId),
          )
        : and(
            eq(signals.datasetId, args.datasetId),
            eq(signals.source, args.source),
            isNull(signals.externalId),
            eq(signals.text, args.text),
            eq(signals.occurredAt, args.occurredAt),
          ),
    )
    .limit(1);
  return (row as Signal | undefined) ?? null;
}
