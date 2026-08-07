import { z } from "zod";
import { db } from "@/db";
import { updateSignalEmbeddingRepo } from "@/repositories/signals/update-signal-embedding-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { EmbeddingSchema } from "@/db/vocabulary";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — attaches the one derived value a signal is allowed to gain. */
export const updateSignalEmbeddingUseCase = createUseCase(
  {
    id: "update-signal-embedding",
    inputSchema: z.object({ id: z.uuid(), embedding: EmbeddingSchema }),
    outputSchema: SignalSchema.nullable(),
  },
  async ({ success }, { id, embedding }) =>
    success(await updateSignalEmbeddingRepo({ db, id, embedding })),
);
