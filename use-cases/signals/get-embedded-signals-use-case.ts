import { z } from "zod";
import { db } from "@/db";
import { getEmbeddedSignalsRepo } from "@/repositories/signals/get-embedded-signals-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the stable-ordered sample the projection basis is fitted on. */
export const getEmbeddedSignalsUseCase = createUseCase(
  {
    id: "get-embedded-signals",
    inputSchema: z.object({ limit: z.number().int().positive() }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success }, { limit }) => success(await getEmbeddedSignalsRepo({ db, limit })),
);
