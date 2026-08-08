import { and, desc, eq, isNull } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

/**
 * Bubbles that still have no name.
 *
 * Naming used to be reachable only through the batch that created a bubble.
 * Now that `signals.ingest` folds synchronously (convergence Decision 2), a
 * bubble can be born between two pipeline runs and would otherwise stay
 * anonymous forever. This is the queue that closes that gap — newest first, so
 * the bubbles an operator is most likely to be looking at get named first.
 */
export async function getUnlabelledGroupsRepo(args: {
  db: Db;
  level: number;
  limit: number;
}): Promise<Group[]> {
  const rows = await args.db
    .select()
    .from(groups)
    .where(and(eq(groups.level, args.level), isNull(groups.label)))
    .orderBy(desc(groups.lastSeen), desc(groups.id))
    .limit(args.limit);

  return rows as Group[];
}
