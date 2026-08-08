import { router } from "./init";
import { gisRouter } from "@/use-cases/gis/gis-router";
import { notesRouter } from "@/use-cases/notes/notes-router";

/** One domain router per entity folder, merged here. */
export const appRouter = router({
  gis: gisRouter,
  notes: notesRouter,
});

export type AppRouter = typeof appRouter;
