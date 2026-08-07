import { z } from "zod";
import { db } from "@/db";
import { getActiveGroupsRepo } from "@/repositories/groups/get-active-groups-repo";
import { GroupSchema } from "@/repositories/groups/group-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the candidate set a new thing is matched against.
 *
 * NOT cached: the grouping verb creates and updates groups as it walks its
 * queue, and the next signal must be able to join the bubble the previous one
 * just made.
 */
export const getActiveGroupsUseCase = createUseCase(
  {
    id: "get-active-groups",
    inputSchema: z.object({
      level: z.number().int().positive(),
      since: z.date(),
      limit: z.number().int().positive(),
    }),
    outputSchema: z.array(GroupSchema),
  },
  async ({ success }, { level, since, limit }) =>
    success(await getActiveGroupsRepo({ db, level, since, limit })),
);
