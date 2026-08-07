import { z } from "zod";
import { db } from "@/db";
import { getProjectionModelRepo } from "@/repositories/projection-models/get-projection-model-repo";
import { ProjectionModelSchema } from "@/repositories/projection-models/projection-model-schema";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — reads the fitted basis. Null means "not fitted yet", not an error. */
export const getProjectionModelUseCase = createUseCase(
  {
    id: "get-projection-model",
    inputSchema: z.object({ kind: z.string().min(1) }),
    outputSchema: ProjectionModelSchema.nullable(),
  },
  async ({ success }, { kind }) => success(await getProjectionModelRepo({ db, kind })),
);
