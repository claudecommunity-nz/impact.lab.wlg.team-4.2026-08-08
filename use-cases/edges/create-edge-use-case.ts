import { z } from "zod";
import { db } from "@/db";
import { createEdgeRepo } from "@/repositories/edges/create-edge-repo";
import { EdgeSchema } from "@/repositories/edges/edge-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the ONLY caller of createEdgeRepo. `reason` is required
 * by the schema, not by convention: a grouping an operator cannot read is a
 * grouping they cannot trust.
 */
export const createEdgeUseCase = createUseCase(
  {
    id: "create-edge",
    inputSchema: z.object({
      fromId: z.uuid(),
      toId: z.uuid(),
      rel: z.string().min(1),
      reason: z.string().min(1),
      createdBy: z.string().min(1),
      weight: z.number().nullable().optional(),
    }),
    outputSchema: EdgeSchema,
  },
  async ({ success }, args) =>
    success(
      await createEdgeRepo({
        db,
        fromId: args.fromId,
        toId: args.toId,
        rel: args.rel,
        reason: args.reason,
        createdBy: args.createdBy,
        weight: args.weight ?? null,
      }),
    ),
);
