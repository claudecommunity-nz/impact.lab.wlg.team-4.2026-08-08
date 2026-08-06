import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { db } from "@/db";
import { deleteNoteRepo } from "@/repositories/notes/delete-note-repo";
import { NoteSchema } from "@/repositories/notes/note-schema";

/** Thin CRUD use case — one repo call; "not found" is an expected error, not a throw. */
export const deleteNoteUseCase = createUseCase(
  {
    id: "delete-note",
    inputSchema: z.object({ id: z.uuid() }),
    outputSchema: NoteSchema,
  },
  async ({ success, error }, { id }) => {
    const deleted = await deleteNoteRepo({ db, id });
    if (!deleted) return error({ message: "Note not found" });
    return success(deleted);
  },
);
