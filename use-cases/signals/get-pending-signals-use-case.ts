import { z } from "zod";
import { db } from "@/db";
import { getPendingSignalsRepo } from "@/repositories/signals/get-pending-signals-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the grouping verb's work queue (signals with no
 * member_of edge yet), oldest occurred_at first.
 *
 * Deliberately NOT cached: the caller assigns these rows as it walks them, so a
 * second read inside the same request must see the shrunken queue.
 */
export const getPendingSignalsUseCase = createUseCase(
  {
    id: "get-pending-signals",
    inputSchema: z.object({ limit: z.number().int().positive() }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success }, { limit }) => success(await getPendingSignalsRepo({ db, limit })),
);
