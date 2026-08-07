import { z } from "zod";
import { db } from "@/db";
import { SignalVectorSchema } from "@/repositories/signal-vectors/signal-vector-schema";
import { upsertSignalVectorsRepo } from "@/repositories/signal-vectors/upsert-signal-vectors-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — writes galaxy coordinates, idempotently, in one round trip. */
export const upsertSignalVectorsUseCase = createUseCase(
  {
    id: "upsert-signal-vectors",
    inputSchema: z.object({
      kind: z.string().min(1),
      vectors: z.array(
        z.object({ signalId: z.uuid(), x: z.number(), y: z.number(), z: z.number() }),
      ),
    }),
    outputSchema: z.array(SignalVectorSchema),
  },
  async ({ success }, { kind, vectors }) =>
    success(await upsertSignalVectorsRepo({ db, kind, vectors })),
);
