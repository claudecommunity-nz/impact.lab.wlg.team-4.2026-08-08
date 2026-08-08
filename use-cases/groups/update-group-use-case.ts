import { z } from "zod";
import { db } from "@/db";
import { GroupSchema } from "@/repositories/groups/group-schema";
import { updateGroupRepo } from "@/repositories/groups/update-group-repo";
import { EmbeddingSchema, GradeSchema, VerificationSchema } from "@/db/vocabulary";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — re-caches a bubble's folded metrics. Generic on purpose:
 * one update use case rather than one per cached field.
 */
export const updateGroupUseCase = createUseCase(
  {
    id: "update-group",
    inputSchema: z.object({
      id: z.uuid(),
      centroidEmbedding: EmbeddingSchema.nullable().optional(),
      centroidLat: z.number().nullable().optional(),
      centroidLng: z.number().nullable().optional(),
      label: z.string().nullable().optional(),
      mass: z.number().optional(),
      velocity: z.number().optional(),
      sourceDiversity: z.number().int().optional(),
      verification: VerificationSchema.nullable().optional(),
      score: z.number().optional(),
      /** The published verdict. Written only by the grading use case. */
      grade: GradeSchema.nullable().optional(),
      reasons: z.array(z.string()).nullable().optional(),
      alertWorthy: z.boolean().optional(),
      firstSeen: z.date().optional(),
      lastSeen: z.date().optional(),
    }),
    outputSchema: GroupSchema.nullable(),
  },
  async ({ success }, args) => {
    // Everything except the id and the logger IS the patch — absent keys stay absent.
    const { id, log, ...patch } = args;
    void log;
    return success(await updateGroupRepo({ db, id, patch }));
  },
);
