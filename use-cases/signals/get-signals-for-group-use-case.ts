import { z } from "zod";
import { db } from "@/db";
import { getSignalsForGroupRepo } from "@/repositories/signals/get-signals-for-group-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — a bubble's members, which is also the traceability hop
 * from a bubble back to the verbatim payloads behind it.
 *
 * NOT cached: the grouping verb re-reads members immediately after writing the
 * edge that added one, and a cached member list would re-cache stale metrics.
 */
export const getSignalsForGroupUseCase = createUseCase(
  {
    id: "get-signals-for-group",
    inputSchema: z.object({ groupId: z.uuid() }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success }, { groupId }) => success(await getSignalsForGroupRepo({ db, groupId })),
);
