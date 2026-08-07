import { z } from "zod";
import { db } from "@/db";
import { AnnotationSchema } from "@/repositories/annotations/annotation-schema";
import { getAnnotationsForNodesRepo } from "@/repositories/annotations/get-annotations-for-nodes-repo";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — every assertion about a page of nodes in one query.
 *
 * NOT cached: the caller asks about a growing member set, so each call is a
 * different key anyway, and the fold must see annotations written moments ago.
 */
export const getAnnotationsForNodesUseCase = createUseCase(
  {
    id: "get-annotations-for-nodes",
    inputSchema: z.object({ nodeIds: z.array(z.uuid()) }),
    outputSchema: z.array(AnnotationSchema),
  },
  async ({ success }, { nodeIds }) =>
    success(await getAnnotationsForNodesRepo({ db, nodeIds })),
);
