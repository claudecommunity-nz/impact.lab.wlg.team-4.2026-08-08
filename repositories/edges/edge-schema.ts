import { z } from "zod";

/**
 * A typed, weighted relationship between any two nodes. `reason` is NOT NULL on
 * purpose: every grouping decision must be readable by the operator who has to
 * trust it. `weight` carries the number behind it (cosine, for member_of).
 */
export const EdgeSchema = z.object({
  id: z.uuid(),
  fromId: z.uuid(),
  toId: z.uuid(),
  /** member_of | duplicate_of | corroborates | contradicts (read as free text). */
  rel: z.string(),
  weight: z.number().nullable(),
  reason: z.string(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
});

export type Edge = z.infer<typeof EdgeSchema>;
