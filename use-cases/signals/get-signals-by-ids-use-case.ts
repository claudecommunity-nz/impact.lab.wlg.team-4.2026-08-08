import { z } from "zod";
import { db } from "@/db";
import { getSignalsByIdsRepo } from "@/repositories/signals/get-signals-by-ids-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the ONLY caller of getSignalsByIdsRepo, and the reason
 * composed use cases pass ids instead of fetched rows: the per-request cache
 * makes the second reader's fetch free.
 */
export const getSignalsByIdsUseCase = createUseCase(
  {
    id: "get-signals-by-ids",
    inputSchema: z.object({ ids: z.array(z.uuid()) }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, queryClient }, { ids }) => {
    const rows = await queryClient.fetchQuery({
      queryKey: ["signals", "byIds", [...ids].sort()],
      queryFn: () => getSignalsByIdsRepo({ db, ids }),
    });
    return success(rows);
  },
);
