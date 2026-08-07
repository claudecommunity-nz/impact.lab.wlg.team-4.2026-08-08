import { projectionModels, type Db } from "@/db";
import { type ProjectionModelPayload } from "@/db/vocabulary";
import { type ProjectionModel } from "./projection-model-schema";

/** One fitted model per kind — upsert, so a re-fit replaces rather than forks. */
export async function putProjectionModelRepo(args: {
  db: Db;
  kind: string;
  model: ProjectionModelPayload;
}): Promise<ProjectionModel> {
  const [row] = await args.db
    .insert(projectionModels)
    .values({ kind: args.kind, model: args.model })
    .onConflictDoUpdate({
      target: projectionModels.kind,
      set: { model: args.model, fittedAt: new Date() },
    })
    .returning();
  return row;
}
