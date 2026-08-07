import { z } from "zod";
import { db } from "@/db";
import { AnnotationSchema } from "@/repositories/annotations/annotation-schema";
import { createAnnotationsRepo } from "@/repositories/annotations/create-annotations-repo";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — bulk-writes open assertions about any node. Keys are
 * never validated against a list: conventions, not constraints.
 */
export const createAnnotationsUseCase = createUseCase(
  {
    id: "create-annotations",
    inputSchema: z.object({
      annotations: z.array(
        z.object({
          nodeId: z.uuid(),
          key: z.string().min(1),
          value: z.string(),
          confidence: z.number().nullable().optional(),
          annotator: z.string().min(1),
        }),
      ),
    }),
    outputSchema: z.array(AnnotationSchema),
  },
  async ({ success }, { annotations }) =>
    success(await createAnnotationsRepo({ db, annotations })),
);
