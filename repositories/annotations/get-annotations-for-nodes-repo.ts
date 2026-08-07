import { asc, inArray } from "drizzle-orm";
import { annotations, type Db } from "@/db";
import { type Annotation } from "./annotation-schema";

/** One query for a whole page of nodes — the read side groups them by nodeId. */
export async function getAnnotationsForNodesRepo(args: {
  db: Db;
  nodeIds: string[];
}): Promise<Annotation[]> {
  if (args.nodeIds.length === 0) return [];
  return args.db
    .select()
    .from(annotations)
    .where(inArray(annotations.nodeId, args.nodeIds))
    .orderBy(asc(annotations.createdAt));
}
