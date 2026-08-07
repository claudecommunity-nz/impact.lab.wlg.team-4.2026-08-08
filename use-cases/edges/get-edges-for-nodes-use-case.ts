import { z } from "zod";
import { db } from "@/db";
import { EdgeSchema } from "@/repositories/edges/edge-schema";
import { getEdgesForNodesRepo } from "@/repositories/edges/get-edges-for-nodes-repo";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — every edge touching a page of nodes, in either
 * direction. The read side filters by `rel`: asking for member_of edges from
 * signals and member_of edges to groups is the same query from two ends, and
 * one round trip is enough for both.
 *
 * Cached per request: a points read and a groups read in the same tRPC batch
 * ask about overlapping nodes.
 */
export const getEdgesForNodesUseCase = createUseCase(
  {
    id: "get-edges-for-nodes",
    inputSchema: z.object({ nodeIds: z.array(z.uuid()) }),
    outputSchema: z.array(EdgeSchema),
  },
  async ({ success, queryClient }, { nodeIds }) => {
    const rows = await queryClient.fetchQuery({
      queryKey: ["edges", "forNodes", [...nodeIds].sort()],
      queryFn: () => getEdgesForNodesRepo({ db, nodeIds }),
    });
    return success(rows);
  },
);
