import { sql } from "drizzle-orm";
import { edges, type Db } from "@/db";
import { type Edge } from "./edge-schema";

/**
 * A node belongs to at most ONE group, enforced by a partial unique index on
 * (from_id) WHERE rel = 'member_of'. Re-grouping therefore MOVES a node rather
 * than duplicating it: the conflict updates the edge in place, keeping the new
 * weight and reason. Other rels can never hit that index, so they insert plainly.
 */
export async function createEdgeRepo(args: {
  db: Db;
  fromId: string;
  toId: string;
  rel: string;
  reason: string;
  createdBy: string;
  weight?: number | null;
}): Promise<Edge> {
  const [row] = await args.db
    .insert(edges)
    .values({
      fromId: args.fromId,
      toId: args.toId,
      rel: args.rel,
      reason: args.reason,
      createdBy: args.createdBy,
      weight: args.weight ?? null,
    })
    .onConflictDoUpdate({
      target: edges.fromId,
      targetWhere: sql`${edges.rel} = 'member_of'`,
      set: {
        toId: args.toId,
        weight: args.weight ?? null,
        reason: args.reason,
        createdBy: args.createdBy,
        createdAt: sql`now()`,
      },
    })
    .returning();
  return row;
}
