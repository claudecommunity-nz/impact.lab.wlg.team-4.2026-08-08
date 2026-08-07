import { and, desc, eq, gte, lte } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

/**
 * Every UI read is a projection of (level, time-range) → bubbles. A group is in
 * the window when its lifespan overlaps it, ranked by score for the queue.
 */
export async function getGroupsRepo(args: {
  db: Db;
  level: number;
  from: Date;
  to: Date;
  limit: number;
}): Promise<Group[]> {
  return args.db
    .select()
    .from(groups)
    .where(
      and(eq(groups.level, args.level), gte(groups.lastSeen, args.from), lte(groups.firstSeen, args.to)),
    )
    .orderBy(desc(groups.score), desc(groups.lastSeen))
    .limit(args.limit);
}
