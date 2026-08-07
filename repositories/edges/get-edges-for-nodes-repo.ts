import { inArray, or } from "drizzle-orm";
import { edges, type Db } from "@/db";
import { type Edge } from "./edge-schema";

/** Every edge touching these nodes, in either direction. */
export async function getEdgesForNodesRepo(args: {
  db: Db;
  nodeIds: string[];
}): Promise<Edge[]> {
  if (args.nodeIds.length === 0) return [];
  return args.db
    .select()
    .from(edges)
    .where(or(inArray(edges.fromId, args.nodeIds), inArray(edges.toId, args.nodeIds)));
}
