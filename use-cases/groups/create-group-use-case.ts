import { z } from "zod";
import { db } from "@/db";
import { createGroupRepo } from "@/repositories/groups/create-group-repo";
import { GroupSchema } from "@/repositories/groups/group-schema";
import { EmbeddingSchema, VerificationSchema } from "@/db/vocabulary";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of createGroupRepo. A bubble is born here. */
export const createGroupUseCase = createUseCase(
  {
    id: "create-group",
    inputSchema: z.object({
      level: z.number().int().positive(),
      centroidEmbedding: EmbeddingSchema.nullable().optional(),
      centroidLat: z.number().nullable().optional(),
      centroidLng: z.number().nullable().optional(),
      label: z.string().nullable().optional(),
      mass: z.number().optional(),
      velocity: z.number().optional(),
      sourceDiversity: z.number().int().optional(),
      verification: VerificationSchema.nullable().optional(),
      /** Required: a bubble that did not know its namespace could cluster across one. */
      datasetId: z.string().min(1),
      firstSeen: z.date().optional(),
      lastSeen: z.date().optional(),
    }),
    outputSchema: GroupSchema,
  },
  async ({ success }, args) =>
    success(
      await createGroupRepo({
        db,
        group: {
          level: args.level,
          datasetId: args.datasetId,
          centroidEmbedding: args.centroidEmbedding ?? null,
          centroidLat: args.centroidLat ?? null,
          centroidLng: args.centroidLng ?? null,
          label: args.label ?? null,
          mass: args.mass ?? 0,
          velocity: args.velocity ?? 0,
          sourceDiversity: args.sourceDiversity ?? 0,
          verification: args.verification ?? null,
          firstSeen: args.firstSeen,
          lastSeen: args.lastSeen,
        },
      }),
    ),
);
