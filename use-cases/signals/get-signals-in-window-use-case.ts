import { z } from "zod";
import { db } from "@/db";
import { getSignalsInWindowRepo } from "@/repositories/signals/get-signals-in-window-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the population of a time window, on the occurred_at
 * clock. Cached per request: the points read and anything composed alongside it
 * in the same tRPC batch share one query.
 */
export const getSignalsInWindowUseCase = createUseCase(
  {
    id: "get-signals-in-window",
    inputSchema: z.object({
      from: z.date(),
      to: z.date(),
      limit: z.number().int().positive(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, queryClient }, { from, to, limit }) => {
    const rows = await queryClient.fetchQuery({
      queryKey: ["signals", "inWindow", from.toISOString(), to.toISOString(), limit],
      queryFn: () => getSignalsInWindowRepo({ db, from, to, limit }),
    });
    return success(rows);
  },
);
