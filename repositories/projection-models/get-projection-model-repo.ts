import { eq } from "drizzle-orm";
import { projectionModels, type Db } from "@/db";
import { type ProjectionModel } from "./projection-model-schema";

export async function getProjectionModelRepo(args: {
  db: Db;
  kind: string;
}): Promise<ProjectionModel | null> {
  const [row] = await args.db
    .select()
    .from(projectionModels)
    .where(eq(projectionModels.kind, args.kind))
    .limit(1);
  return row ?? null;
}
