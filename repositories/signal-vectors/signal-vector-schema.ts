import { z } from "zod";

/**
 * A signal's coordinates in a fitted projection. Derived and rebuildable: drop
 * every row and re-run the projection verb and you get the same numbers back,
 * because the basis is stored, not refitted.
 */
export const SignalVectorSchema = z.object({
  signalId: z.uuid(),
  /** Which fitted basis these coordinates are in (matches projection_models.kind). */
  kind: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  projectedAt: z.coerce.date(),
});

export type SignalVector = z.infer<typeof SignalVectorSchema>;
