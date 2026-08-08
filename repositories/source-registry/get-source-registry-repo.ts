import { asc, inArray } from "drizzle-orm";
import { sourceRegistry, type Db } from "@/db";
import { type SourceRegistryEntry } from "./source-registry-schema";

/**
 * The whole registry, or just the sources a batch of items actually came from.
 *
 * Small enough to read whole (tens of rows), and grading needs the letter for
 * every contributing source at once — one query per cluster, not one per item.
 */
export async function getSourceRegistryRepo(args: {
  db: Db;
  /** Absent = every entry. */
  sourceIds?: string[];
}): Promise<SourceRegistryEntry[]> {
  const rows =
    args.sourceIds === undefined
      ? await args.db.select().from(sourceRegistry).orderBy(asc(sourceRegistry.sourceId))
      : args.sourceIds.length === 0
        ? []
        : await args.db
            .select()
            .from(sourceRegistry)
            .where(inArray(sourceRegistry.sourceId, args.sourceIds))
            .orderBy(asc(sourceRegistry.sourceId));

  return rows as SourceRegistryEntry[];
}
