import { z } from "zod";
import { db } from "@/db";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { getSignalsForGroupsRepo } from "@/repositories/signals/get-signals-for-groups-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of getSignalsForGroupsRepo. */
export const getSignalsForGroupsUseCase = createUseCase(
  {
    id: "get-signals-for-groups",
    inputSchema: z.object({
      groupIds: z.array(z.uuid()),
      /** Filters on ingested_at — what was KNOWABLE at that instant. */
      asAt: z.date().optional(),
    }),
    outputSchema: z.array(z.object({ groupId: z.uuid(), signal: SignalSchema })),
  },
  async ({ success }, { groupIds, asAt }) =>
    success(await getSignalsForGroupsRepo({ db, groupIds, asAt })),
);
