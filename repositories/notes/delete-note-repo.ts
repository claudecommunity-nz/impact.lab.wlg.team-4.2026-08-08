import { eq } from "drizzle-orm";
import { notes, type Db } from "@/db";
import { type Note } from "./note-schema";

/** Returns the deleted note, or null if no row matched. */
export async function deleteNoteRepo(args: { db: Db; id: string }): Promise<Note | null> {
  const [row] = await args.db.delete(notes).where(eq(notes.id, args.id)).returning();
  return row ?? null;
}
