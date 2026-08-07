import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { NoteSchema } from "@/repositories/notes/note-schema";
import { suggestNoteTitleUseCase } from "@/use-cases/ai/suggest-note-title-use-case";
import { createNoteUseCase } from "./create-note-use-case";

/**
 * Business-logic use case — the reference for composition: it calls OTHER USE
 * CASES (thin CRUD + thin integration), never repos. Repos are reached only
 * through their entity's thin CRUD use case (create-note-use-case.ts).
 * Composed results are checked and propagated — never ignored.
 */
export const captureNoteUseCase = createUseCase(
  {
    id: "capture-note",
    inputSchema: z.object({
      title: z.string().min(1).optional(),
      content: z.string().min(1),
    }),
    outputSchema: NoteSchema,
  },
  async ({ success, error }, { title, content, log }) => {
    let resolvedTitle = title;
    if (resolvedTitle === undefined) {
      // The business logic: AI fills a missing title.
      const suggested = await suggestNoteTitleUseCase({ content, log });
      if (suggested.error) return error(suggested.error);
      resolvedTitle = suggested.data.title;
      log?.info({ generatedTitle: true }, "Resolved note title via AI");
    }

    const created = await createNoteUseCase({ title: resolvedTitle, content, log });
    if (created.error) return error(created.error);
    return success(created.data);
  },
);
