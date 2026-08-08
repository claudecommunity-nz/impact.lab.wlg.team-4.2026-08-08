import { router } from "./init";
import { gisRouter } from "@/use-cases/gis/gis-router";
import { notesRouter } from "@/use-cases/notes/notes-router";
import { signalsRouter } from "@/use-cases/signals/signals-router";
import { sourcesRouter } from "@/use-cases/source-registry/sources-router";
import { vectorsRouter } from "@/use-cases/vectors/vectors-router";

/** One domain router per entity folder, merged here. */
export const appRouter = router({
  gis: gisRouter,
  notes: notesRouter,
  signals: signalsRouter,
  sources: sourcesRouter,
  vectors: vectorsRouter,
});

export type AppRouter = typeof appRouter;
