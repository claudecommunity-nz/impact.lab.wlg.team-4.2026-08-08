import { z } from "zod";
import { GradeSchema } from "@/db/vocabulary";

/**
 * One transition in a cluster's grade. APPEND ONLY — never updated, never
 * deleted, so "what did we believe at 09:40?" has an answer, and so an alert
 * (which fires on a transition, not on a state) is backed by a record.
 */
export const GradeEventSchema = z.object({
  id: z.uuid(),
  /** The cluster — published as `signalId`. */
  groupId: z.uuid(),
  datasetId: z.string(),
  /** null on the first grade a cluster is ever given. */
  fromGrade: GradeSchema.nullable(),
  toGrade: GradeSchema,
  at: z.coerce.date(),
  /** Distinct origins at this transition — never the item count. */
  independentSources: z.number().int(),
  itemCount: z.number().int(),
  reasons: z.array(z.string()),
  alertFired: z.boolean(),
  alertReasons: z.array(z.string()).nullable(),
});

export type GradeEvent = z.infer<typeof GradeEventSchema>;
