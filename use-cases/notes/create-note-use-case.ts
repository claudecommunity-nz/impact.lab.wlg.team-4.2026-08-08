import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { db } from "@/db";
import { createNoteRepo } from "@/repositories/notes/create-note-repo";
import { NoteSchema } from "@/repositories/notes/note-schema";

/**
 * Thin CRUD use case — the ONLY caller of createNoteRepo. No business logic
 * here: business logic lives in use cases that compose this one
 * (see capture-note-use-case.ts).
 */
export const createNoteUseCase = createUseCase(
  {
    id: "create-note",
    inputSchema: z.object({
      title: z.string().min(1),
      content: z.string().min(1),
    }),
    outputSchema: NoteSchema,
  },
  async ({ success }, { title, content }) => {
    const note = await createNoteRepo({ db, title, content });
    return success(note);
  },
);
