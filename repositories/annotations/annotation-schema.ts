import { z } from "zod";

/**
 * An open assertion about any node. `nodeId` is polymorphic (signal or group)
 * and deliberately carries no foreign key — conventions, not constraints.
 * Unknown keys are kept and displayed; only promoted keys drive ranking.
 */
export const AnnotationSchema = z.object({
  id: z.uuid(),
  nodeId: z.uuid(),
  key: z.string(),
  value: z.string(),
  confidence: z.number().nullable(),
  /** claude | feed | rule | operator — read as free text (see db/vocabulary.ts). */
  annotator: z.string(),
  createdAt: z.coerce.date(),
});

export type Annotation = z.infer<typeof AnnotationSchema>;
