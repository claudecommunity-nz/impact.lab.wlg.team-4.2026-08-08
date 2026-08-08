import { and, desc, eq, gte } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

/**
 * The candidate set the grouping verb matches new things against: bubbles at
 * this level, IN THIS DATASET, still alive in the recency window, hottest first.
 *
 * `datasetId` is a gate, not a filter — the same hard rule as the geo gate.
 * A replayed drill and the live picture may contain byte-identical reports; if
 * they could cluster together, a demo would silently corroborate a real event
 * and the independence count would be a lie.
 *
 * `id` is a TIEBREAK, not decoration: the caller picks the winner with a strict
 * `>`, so on an exact cosine tie the first candidate iterated wins. Two bubbles
 * sharing a `last_seen` would then make that iteration order — and the whole
 * grouping — depend on whatever the planner happened to return.
 */
export async function getActiveGroupsRepo(args: {
  db: Db;
  level: number;
  since: Date;
  datasetId: string;
  limit: number;
}): Promise<Group[]> {
  const rows = await args.db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.level, args.level),
        eq(groups.datasetId, args.datasetId),
        gte(groups.lastSeen, args.since),
      ),
    )
    .orderBy(desc(groups.lastSeen), desc(groups.id))
    .limit(args.limit);

  return rows as Group[];
}
