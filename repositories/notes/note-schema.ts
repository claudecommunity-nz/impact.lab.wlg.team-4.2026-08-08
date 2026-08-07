import { z } from "zod";

/**
 * The entity schema — the shape every layer above the repo speaks.
 * Repos return full entities, never individual columns.
 */
export const NoteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  content: z.string(),
  createdAt: z.coerce.date(),
});

export type Note = z.infer<typeof NoteSchema>;
