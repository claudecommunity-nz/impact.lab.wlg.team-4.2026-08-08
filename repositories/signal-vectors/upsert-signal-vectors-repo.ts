import { sql } from "drizzle-orm";
import { signalVectors, type Db } from "@/db";
import { type SignalVector } from "./signal-vector-schema";

/**
 * Bulk upsert on (signal_id, kind) — a re-projection overwrites in place rather
 * than forking, so re-running the pipeline is idempotent and the galaxy never
 * grows ghost points. `excluded.*` is the row Postgres would have inserted.
 */
export async function upsertSignalVectorsRepo(args: {
  db: Db;
  kind: string;
  vectors: { signalId: string; x: number; y: number; z: number }[];
}): Promise<SignalVector[]> {
  if (args.vectors.length === 0) return [];

  return args.db
    .insert(signalVectors)
    .values(args.vectors.map((v) => ({ ...v, kind: args.kind })))
    .onConflictDoUpdate({
      target: [signalVectors.signalId, signalVectors.kind],
      set: {
        x: sql`excluded.x`,
        y: sql`excluded.y`,
        z: sql`excluded.z`,
        projectedAt: new Date(),
      },
    })
    .returning();
}
