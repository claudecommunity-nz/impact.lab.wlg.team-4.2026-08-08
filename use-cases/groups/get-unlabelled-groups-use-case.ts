import { z } from "zod";
import { db } from "@/db";
import { GroupSchema } from "@/repositories/groups/group-schema";
import { getUnlabelledGroupsRepo } from "@/repositories/groups/get-unlabelled-groups-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of getUnlabelledGroupsRepo. */
export const getUnlabelledGroupsUseCase = createUseCase(
  {
    id: "get-unlabelled-groups",
    inputSchema: z.object({
      level: z.number().int().positive(),
      limit: z.number().int().positive(),
    }),
    outputSchema: z.array(GroupSchema),
  },
  async ({ success }, { level, limit }) =>
    success(await getUnlabelledGroupsRepo({ db, level, limit })),
);
