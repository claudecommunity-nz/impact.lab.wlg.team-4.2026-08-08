import { z } from "zod";
import { router, publicProcedure } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import { db } from "@/db";
import { getNotesRepo } from "@/repositories/notes/get-notes-repo";
import { NoteSchema } from "@/repositories/notes/note-schema";
import { captureNoteUseCase } from "./capture-note-use-case";
import { deleteNoteUseCase } from "./delete-note-use-case";

/**
 * The domain's boundary — procedures replace action files, and a procedure with
 * an `if` in it is a bug:
 *
 * - Pure-fetch QUERY: wraps exactly ONE repo call (the thin-CRUD role). Promote
 *   to a read use case the moment logic creeps in or a second caller appears.
 * - MUTATION: one-line callUseCase(...) into a business-logic use case.
 */
export const notesRouter = router({
  list: publicProcedure
    .output(z.array(NoteSchema))
    .query(() => getNotesRepo({ db })),

  capture: publicProcedure
    .input(
      z.object({
        title: z.string().min(1).optional(),
        content: z.string().min(1),
      }),
    )
    .output(NoteSchema)
    .mutation(({ ctx, input }) => callUseCase(captureNoteUseCase({ ...input, log: ctx.log }))),

  delete: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .output(NoteSchema)
    .mutation(({ ctx, input }) => callUseCase(deleteNoteUseCase({ ...input, log: ctx.log }))),
});
