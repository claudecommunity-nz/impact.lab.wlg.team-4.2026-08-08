import { notes, type Db } from "@/db";
import { type Note } from "./note-schema";

export async function createNoteRepo(args: {
  db: Db;
  title: string;
  content: string;
}): Promise<Note> {
  const [row] = await args.db
    .insert(notes)
    .values({ title: args.title, content: args.content })
    .returning();
  return row;
}
