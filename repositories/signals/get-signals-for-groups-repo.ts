import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { edges, signals, type Db } from "@/db";
import { MEMBER_OF } from "@/db/vocabulary";
import { type Signal } from "./signal-schema";

/**
 * The members of MANY bubbles in one query — the batched sibling of
 * `get-signals-for-group-repo`.
 *
 * `signals.geojson` needs every contributing item of every cluster on the board
 * (to count them, to know whether any was synthetic, and to honour `asAt`).
 * Doing that one cluster at a time is fifty round trips to draw one map.
 *
 * `asAt` filters on `ingested_at` — WHEN WE LEARNED of the item, not when it
 * happened. A time-scrubbed map must show what was knowable at that moment,
 * and an item published at 09:00 but only collected at 11:00 was not knowable
 * at 10:00 however early its own timestamp reads.
 */
export async function getSignalsForGroupsRepo(args: {
  db: Db;
  groupIds: string[];
  asAt?: Date;
}): Promise<{ groupId: string; signal: Signal }[]> {
  if (args.groupIds.length === 0) return [];

  const rows = await args.db
    .select({ groupId: edges.toId, signal: signals })
    .from(signals)
    .innerJoin(
      edges,
      and(
        eq(edges.fromId, signals.id),
        eq(edges.rel, MEMBER_OF),
        inArray(edges.toId, args.groupIds),
      ),
    )
    .where(args.asAt ? lte(signals.ingestedAt, args.asAt) : undefined)
    .orderBy(desc(signals.occurredAt), desc(signals.id));

  return rows.map((r) => ({ groupId: r.groupId, signal: r.signal as Signal }));
}
