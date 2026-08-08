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
  /** The namespace — live vs replay vs fixtures. Clustering never crosses one. */
  datasetId: z.string(),
  /** The collector's stable id, when it had one. Drives the strong dedupe key. */
  externalId: z.string().nullable(),
  author: z.string().nullable(),
  url: z.string().nullable(),
  quotedUrls: z.array(z.string()).nullable(),
  /** Authored for a demo or drill — surfaced on every provenance entry. */
  synthetic: z.boolean(),
});

export type Signal = z.infer<typeof SignalSchema>;
