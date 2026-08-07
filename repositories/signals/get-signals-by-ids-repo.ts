import { inArray } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/** Composed reads pass ids, never fetched data — this is the re-fetch. */
export async function getSignalsByIdsRepo(args: { db: Db; ids: string[] }): Promise<Signal[]> {
  if (args.ids.length === 0) return [];
  return args.db.select().from(signals).where(inArray(signals.id, args.ids));
}
