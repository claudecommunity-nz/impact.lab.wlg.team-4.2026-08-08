import { desc } from "drizzle-orm";
import { notes, type Db } from "@/db";
import { type Note } from "./note-schema";

export async function getNotesRepo(args: { db: Db }): Promise<Note[]> {
  return args.db.select().from(notes).orderBy(desc(notes.createdAt));
}
