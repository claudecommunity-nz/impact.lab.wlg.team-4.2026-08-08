import { z } from "zod";
import { publicProcedure, router } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import { GroupDetailSchema, getGroupDetailUseCase } from "./get-group-detail-use-case";
import { GROUPS_LIMIT, GroupViewSchema, getGroupsViewUseCase } from "./get-groups-view-use-case";
import { POINTS_LIMIT, PointSchema, getPointsUseCase } from "./get-points-use-case";
import {
  PROCESS_BATCH_LIMIT,
  ProcessPendingResultSchema,
  processPendingUseCase,
} from "./process-pending-use-case";

/**
 * The vector layer's boundary: one verb and three reads.
 *
 * `process` is deliberately the whole pipeline (embed → assign → name → project)
 * rather than four procedures: partial runs are what produce bubbles with stale
 * centroids. It is safe to call repeatedly and safe to call concurrently; a
 * second caller gets `locked: false` rather than a duplicate run.
 *
 * The three reads are one drill-down, not three views — `points` draws the
 * galaxy, `groups` draws the bubbles over it, `groupDetail` opens one bubble
 * all the way down to the verbatim payloads behind it. THESE SHAPES ARE FROZEN:
 * the UX team builds against them and other teams read them over HTTP
 * (INTEGRATION.md). Add fields; never rename or remove one.
 *
 * `windowMins` is optional everywhere and means the same thing everywhere: the
 * last N minutes of the picture, anchored on the newest observation we hold
 * (utilities/window.ts). Absent = everything.
 */
export const vectorsRouter = router({
  process: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(500).default(PROCESS_BATCH_LIMIT) }))
    .output(ProcessPendingResultSchema)
    .mutation(({ ctx, input }) => callUseCase(processPendingUseCase({ ...input, log: ctx.log }))),

  points: publicProcedure
    .input(
      z.object({
        windowMins: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(POINTS_LIMIT).optional(),
        datasetId: z.string().min(1).optional(),
      }),
    )
    .output(z.array(PointSchema))
    .query(({ ctx, input }) => callUseCase(getPointsUseCase({ ...input, log: ctx.log }))),

  groups: publicProcedure
    .input(
      z.object({
        windowMins: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(GROUPS_LIMIT).optional(),
        datasetId: z.string().min(1).optional(),
        asAt: z.coerce.date().optional(),
      }),
    )
    .output(z.array(GroupViewSchema))
    .query(({ ctx, input }) => callUseCase(getGroupsViewUseCase({ ...input, log: ctx.log }))),

  groupDetail: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .output(GroupDetailSchema)
    .query(({ ctx, input }) => callUseCase(getGroupDetailUseCase({ ...input, log: ctx.log }))),
});
