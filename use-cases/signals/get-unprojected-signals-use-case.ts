import { z } from "zod";
import { db } from "@/db";
import { getUnprojectedSignalsRepo } from "@/repositories/signals/get-unprojected-signals-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — embedded signals with no coordinates yet in this basis. */
export const getUnprojectedSignalsUseCase = createUseCase(
  {
    id: "get-unprojected-signals",
    inputSchema: z.object({ kind: z.string().min(1), limit: z.number().int().positive() }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success }, { kind, limit }) =>
    success(await getUnprojectedSignalsRepo({ db, kind, limit })),
);
