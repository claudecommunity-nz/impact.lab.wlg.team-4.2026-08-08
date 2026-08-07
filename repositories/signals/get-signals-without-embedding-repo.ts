import { asc, isNull } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/** The enrich verb's work queue: signals that still need an embedding. */
export async function getSignalsWithoutEmbeddingRepo(args: {
  db: Db;
  limit: number;
}): Promise<Signal[]> {
  return args.db
    .select()
    .from(signals)
    .where(isNull(signals.embedding))
    .orderBy(asc(signals.ingestedAt))
    .limit(args.limit);
}
