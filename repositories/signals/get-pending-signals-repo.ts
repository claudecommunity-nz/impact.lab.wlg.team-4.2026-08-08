import { and, asc, eq, notExists } from "drizzle-orm";
import { edges, signals, type Db } from "@/db";
import { MEMBER_OF } from "@/db/vocabulary";
import { type Signal } from "./signal-schema";

/**
 * Signals not yet placed in a group — the grouping verb's work queue.
 * Oldest first, so replay and live catch-up produce the same bubbles.
 */
export async function getPendingSignalsRepo(args: { db: Db; limit: number }): Promise<Signal[]> {
  return args.db
    .select()
    .from(signals)
    .where(
      notExists(
        args.db
          .select({ id: edges.id })
          .from(edges)
          .where(and(eq(edges.fromId, signals.id), eq(edges.rel, MEMBER_OF))),
      ),
    )
    .orderBy(asc(signals.occurredAt))
    .limit(args.limit);
}
