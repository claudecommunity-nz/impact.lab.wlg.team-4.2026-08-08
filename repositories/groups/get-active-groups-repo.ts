import { and, desc, eq, gte } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

/**
 * The candidate set the grouping verb matches new things against: bubbles at
 * this level still alive in the recency window, hottest first.
 */
export async function getActiveGroupsRepo(args: {
  db: Db;
  level: number;
  since: Date;
  limit: number;
}): Promise<Group[]> {
  return args.db
    .select()
    .from(groups)
    .where(and(eq(groups.level, args.level), gte(groups.lastSeen, args.since)))
    .orderBy(desc(groups.lastSeen))
    .limit(args.limit);
}
