import { z } from "zod";
import { db } from "@/db";
import { getGroupRepo } from "@/repositories/groups/get-group-repo";
import { GroupSchema } from "@/repositories/groups/group-schema";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — one bubble by id, or null. Cached per request. */
export const getGroupUseCase = createUseCase(
  {
    id: "get-group",
    inputSchema: z.object({ id: z.uuid() }),
    outputSchema: GroupSchema.nullable(),
  },
  async ({ success, queryClient }, { id }) => {
    const row = await queryClient.fetchQuery({
      queryKey: ["groups", "byId", id],
      queryFn: () => getGroupRepo({ db, id }),
    });
    return success(row);
  },
);
