import { z } from "zod";
import { SOURCE_RELIABILITY } from "@/db/vocabulary";

/**
 * A source we have met, and how reliable it has proved.
 *
 * `reliability` is the A–F axis of the Admiralty grade, and it is the ONLY
 * place that letter comes from. A source absent from this table is F —
 * "reliability cannot be judged" — because knowing nothing about a source is
 * not the same as knowing it is mediocre.
 */
export const SourceRegistryEntrySchema = z.object({
  id: z.uuid(),
  /** Matches `signals.source` exactly. */
  sourceId: z.string(),
  name: z.string(),
  reliability: z.enum(SOURCE_RELIABILITY),
  /** official | media | social | sensor | community — open text. */
  kind: z.string(),
  /** Why this source carries this grade, in words. */
  notes: z.string().nullable(),
  updatedAt: z.coerce.date(),
});

export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;
