import { and, desc, eq, gte, lte } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

/**
 * The board's rows: bubbles at this level whose lifespan overlaps the window,
 * ranked by the internal score (`groups.score` never leaves this layer — the
 * published surface carries a grade, never a blended number).
 *
 * `datasetId` is optional here and REQUIRED in the clustering path: a read may
 * legitimately want to look at a replay, but a fold must never mix two.
 */
export async function getGroupsRepo(args: {
  db: Db;
  level: number;
  from: Date;
  to: Date;
  datasetId?: string;
  limit: number;
}): Promise<Group[]> {
  const rows = await args.db
    .select()
    .from(groups)
    .where(
      and(
        eq(groups.level, args.level),
        gte(groups.lastSeen, args.from),
        lte(groups.firstSeen, args.to),
        args.datasetId ? eq(groups.datasetId, args.datasetId) : undefined,
      ),
    )
    // Same tiebreak reasoning as get-active-groups-repo: the queue's order must
    // not depend on the planner when two bubbles rank identically.
    .orderBy(desc(groups.score), desc(groups.lastSeen), desc(groups.id))
    .limit(args.limit);

  return rows as Group[];
}
