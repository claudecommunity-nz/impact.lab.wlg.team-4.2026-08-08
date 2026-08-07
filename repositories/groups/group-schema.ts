import { z } from "zod";
import { EmbeddingSchema, VerificationSchema } from "@/db/vocabulary";

/**
 * A bubble, at any depth — level 1 = incidents (signals inside), level 2 =
 * themes (groups inside). Depth IS the kind. Every metric here is a CACHE of a
 * fold over the members: truncate and re-run the verbs and you get it back.
 */
export const GroupSchema = z.object({
  id: z.uuid(),
  level: z.number().int(),
  centroidEmbedding: EmbeddingSchema.nullable(),
  centroidLat: z.number().nullable(),
  centroidLng: z.number().nullable(),
  label: z.string().nullable(),
  /** Member count / weight in the window. */
  mass: z.number(),
  /** Mass differenced across windows. */
  velocity: z.number(),
  /** COUNT(DISTINCT source_class) across members — the diversity axis. */
  sourceDiversity: z.number().int(),
  verification: VerificationSchema.nullable(),
  score: z.number(),
  firstSeen: z.coerce.date(),
  lastSeen: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Group = z.infer<typeof GroupSchema>;
