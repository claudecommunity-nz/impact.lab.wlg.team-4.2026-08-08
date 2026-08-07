import { and, eq } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/**
 * The dedupe key: source + text + occurred_at. Re-delivering the same payload
 * (a re-poll, a replayed file) must not inflate a bubble's mass.
 */
export async function getSignalByDedupeRepo(args: {
  db: Db;
  source: string;
  text: string;
  occurredAt: Date;
}): Promise<Signal | null> {
  const [row] = await args.db
    .select()
    .from(signals)
    .where(
      and(
        eq(signals.source, args.source),
        eq(signals.text, args.text),
        eq(signals.occurredAt, args.occurredAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
