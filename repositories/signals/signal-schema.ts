import { z } from "zod";
import { EmbeddingSchema, RawPayloadSchema } from "@/db/vocabulary";

/**
 * The entity schema — the shape every layer above the repo speaks.
 * A signal is immutable: `raw` is the source payload kept verbatim, forever,
 * which is what makes any bubble traceable back to what was actually said.
 */
export const SignalSchema = z.object({
  id: z.uuid(),
  occurredAt: z.coerce.date(),
  ingestedAt: z.coerce.date(),
  source: z.string(),
  /** OPEN TEXT — never validated against an enum. */
  sourceClass: z.string(),
  raw: RawPayloadSchema,
  text: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  geoConfidence: z.number().nullable(),
  embedding: EmbeddingSchema.nullable(),
});

export type Signal = z.infer<typeof SignalSchema>;
