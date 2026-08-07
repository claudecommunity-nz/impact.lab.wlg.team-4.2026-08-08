import { router } from "./init";
import { notesRouter } from "@/use-cases/notes/notes-router";

/** One domain router per entity folder, merged here. */
export const appRouter = router({
  notes: notesRouter,
});

export type AppRouter = typeof appRouter;
