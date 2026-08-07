import { eq } from "drizzle-orm";
import { signals, type Db } from "@/db";
import { type Embedding } from "@/db/vocabulary";
import { type Signal } from "./signal-schema";

/**
 * The one mutation a signal allows: attaching its embedding. Facts are
 * immutable; derived vectors are rebuildable.
 */
export async function updateSignalEmbeddingRepo(args: {
  db: Db;
  id: string;
  embedding: Embedding;
}): Promise<Signal | null> {
  const [row] = await args.db
    .update(signals)
    .set({ embedding: args.embedding })
    .where(eq(signals.id, args.id))
    .returning();
  return row ?? null;
}
