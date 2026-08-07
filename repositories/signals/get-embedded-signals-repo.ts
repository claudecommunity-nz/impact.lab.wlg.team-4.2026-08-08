import { asc, isNotNull } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/**
 * The sample the projection basis is fitted on, in a STABLE order.
 *
 * Ordered by occurred_at, then source, then text — deliberately not by id.
 * Ids are random uuids, so an id tiebreak would feed the same signals to the
 * fit in a different row order on every rebuild, and floating-point summation
 * order would make the basis differ in its last bits. Same data in, same basis
 * out, on any machine: that is what makes the galaxy comparable across runs.
 */
export async function getEmbeddedSignalsRepo(args: { db: Db; limit: number }): Promise<Signal[]> {
  return args.db
    .select()
    .from(signals)
    .where(isNotNull(signals.embedding))
    .orderBy(asc(signals.occurredAt), asc(signals.source), asc(signals.text))
    .limit(args.limit);
}
