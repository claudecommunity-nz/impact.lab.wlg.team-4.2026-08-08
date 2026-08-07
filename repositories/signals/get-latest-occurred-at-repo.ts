import { desc } from "drizzle-orm";
import { signals, type Db } from "@/db";

/**
 * The newest observation we hold, on the `occurred_at` clock — the anchor every
 * windowed read hangs off (see utilities/window.ts for why it is not just now).
 *
 * Returns a column rather than an entity, the one deliberate exception to the
 * full-entities rule: this is an aggregate, not a row, and fetching the whole
 * signal to read one timestamp would be worse.
 */
export async function getLatestOccurredAtRepo(args: { db: Db }): Promise<Date | null> {
  const [row] = await args.db
    .select({ occurredAt: signals.occurredAt })
    .from(signals)
    .orderBy(desc(signals.occurredAt))
    .limit(1);
  return row?.occurredAt ?? null;
}
