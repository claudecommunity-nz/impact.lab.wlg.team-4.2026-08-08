import { sql } from "drizzle-orm";
import { sourceRegistry, type Db } from "@/db";
import { type SourceRegistryEntry } from "./source-registry-schema";

/**
 * Idempotent by `source_id`: re-seeding, or an operator re-grading a source,
 * updates the row rather than growing a second opinion about the same source.
 */
export async function upsertSourceRegistryRepo(args: {
  db: Db;
  entries: {
    sourceId: string;
    name: string;
    reliability: string;
    kind: string;
    notes?: string | null;
  }[];
}): Promise<SourceRegistryEntry[]> {
  if (args.entries.length === 0) return [];

  const rows = await args.db
    .insert(sourceRegistry)
    .values(
      args.entries.map((entry) => ({
        sourceId: entry.sourceId,
        name: entry.name,
        reliability: entry.reliability,
        kind: entry.kind,
        notes: entry.notes ?? null,
      })),
    )
    // Last writer wins, deliberately: this is how an operator re-grades a source
    // mid-event ("that account has been right all morning") without a deploy.
    .onConflictDoUpdate({
      target: sourceRegistry.sourceId,
      set: {
        name: sql`excluded.name`,
        reliability: sql`excluded.reliability`,
        kind: sql`excluded.kind`,
        notes: sql`excluded.notes`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return rows as SourceRegistryEntry[];
}
