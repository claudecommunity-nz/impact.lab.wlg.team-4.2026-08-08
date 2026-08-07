import { eq } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

type GroupInsert = typeof groups.$inferInsert;

/** Re-caches the folded metrics on a bubble. Returns null if no row matched. */
export async function updateGroupRepo(args: {
  db: Db;
  id: string;
  patch: Partial<Omit<GroupInsert, "id">>;
}): Promise<Group | null> {
  const [row] = await args.db
    .update(groups)
    .set({ ...args.patch, updatedAt: new Date() })
    .where(eq(groups.id, args.id))
    .returning();
  return row ?? null;
}
