import { z } from "zod";
import { ProjectionModelPayloadSchema } from "@/db/vocabulary";

/**
 * A FIXED reference projection for the galaxy view: fit once, transform new
 * points forever after. Refitting per range makes bubbles jump and ranges
 * incomparable, so the fitted model is stored, not recomputed.
 */
export const ProjectionModelSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  model: ProjectionModelPayloadSchema,
  fittedAt: z.coerce.date(),
});

export type ProjectionModel = z.infer<typeof ProjectionModelSchema>;
