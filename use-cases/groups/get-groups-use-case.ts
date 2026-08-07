import { z } from "zod";
import { db } from "@/db";
import { getGroupsRepo } from "@/repositories/groups/get-groups-repo";
import { GroupSchema } from "@/repositories/groups/group-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the bubbles whose lifespan overlaps a window, ranked for
 * the queue. Distinct from getActiveGroupsUseCase, which is the WRITE side's
 * candidate set (recency-only, uncached, because grouping must see the bubble
 * the previous signal just made). This one is the read side, and is cached per
 * request.
 */
export const getGroupsUseCase = createUseCase(
  {
    id: "get-groups",
    inputSchema: z.object({
      level: z.number().int().positive(),
      from: z.date(),
      to: z.date(),
      limit: z.number().int().positive(),
    }),
    outputSchema: z.array(GroupSchema),
  },
  async ({ success, queryClient }, { level, from, to, limit }) => {
    const rows = await queryClient.fetchQuery({
      queryKey: ["groups", "inWindow", level, from.toISOString(), to.toISOString(), limit],
      queryFn: () => getGroupsRepo({ db, level, from, to, limit }),
    });
    return success(rows);
  },
);
