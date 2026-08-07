import { router } from "./init";
import { notesRouter } from "@/use-cases/notes/notes-router";
import { signalsRouter } from "@/use-cases/signals/signals-router";

/** One domain router per entity folder, merged here. */
export const appRouter = router({
  notes: notesRouter,
  signals: signalsRouter,
});

export type AppRouter = typeof appRouter;
