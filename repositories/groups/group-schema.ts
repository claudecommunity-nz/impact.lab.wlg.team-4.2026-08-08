import { z } from "zod";
import { EmbeddingSchema, GradeSchema, VerificationSchema } from "@/db/vocabulary";

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
  /** INTERNAL ordering key. Stripped from every published response (Decision 3). */
  score: z.number(),
  /** The namespace this cluster lives in. */
  datasetId: z.string(),
  /** Admiralty grade — null until the cluster has been graded once. */
  grade: GradeSchema.nullable(),
  /** Ordered reasons behind that grade, most decisive first. */
  reasons: z.array(z.string()).nullable(),
  /** Computed independently of the grade — a weak early signal still alerts. */
  alertWorthy: z.boolean(),
  /** A person's name, or null. Never machine-set. */
  confirmedBy: z.string().nullable(),
  firstSeen: z.coerce.date(),
  lastSeen: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type Group = z.infer<typeof GroupSchema>;
