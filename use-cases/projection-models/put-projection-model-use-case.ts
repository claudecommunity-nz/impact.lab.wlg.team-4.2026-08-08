import { z } from "zod";
import { db } from "@/db";
import { ProjectionModelSchema } from "@/repositories/projection-models/projection-model-schema";
import { putProjectionModelRepo } from "@/repositories/projection-models/put-projection-model-repo";
import { ProjectionModelPayloadSchema } from "@/db/vocabulary";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — stores the fitted basis. Called exactly once per kind, ever. */
export const putProjectionModelUseCase = createUseCase(
  {
    id: "put-projection-model",
    inputSchema: z.object({ kind: z.string().min(1), model: ProjectionModelPayloadSchema }),
    outputSchema: ProjectionModelSchema,
  },
  async ({ success }, { kind, model }) => success(await putProjectionModelRepo({ db, kind, model })),
);
