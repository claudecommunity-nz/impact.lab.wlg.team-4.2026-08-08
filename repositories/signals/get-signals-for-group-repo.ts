import { and, desc, eq } from "drizzle-orm";
import { edges, signals, type Db } from "@/db";
import { MEMBER_OF } from "@/db/vocabulary";
import { type Signal } from "./signal-schema";

/** The members of a bubble — the traceability hop from group back to verbatim source. */
export async function getSignalsForGroupRepo(args: { db: Db; groupId: string }): Promise<Signal[]> {
  const rows = await args.db
    .select({ signal: signals })
    .from(signals)
    .innerJoin(
      edges,
      and(
        eq(edges.fromId, signals.id),
        eq(edges.rel, MEMBER_OF),
        eq(edges.toId, args.groupId),
      ),
    )
    .orderBy(desc(signals.occurredAt));
  return rows.map((r) => r.signal);
}
