import { z } from "zod";
import { publicProcedure, router } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import {
  PROCESS_BATCH_LIMIT,
  ProcessPendingResultSchema,
  processPendingUseCase,
} from "./process-pending-use-case";

/**
 * The vector layer's boundary — one verb.
 *
 * `process` is deliberately the whole pipeline (embed → assign → project)
 * rather than three procedures: partial runs are what produce bubbles with
 * stale centroids. It is safe to call repeatedly and safe to call concurrently;
 * a second caller gets `locked: false` rather than a duplicate run.
 */
export const vectorsRouter = router({
  process: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(500).default(PROCESS_BATCH_LIMIT) }))
    .output(ProcessPendingResultSchema)
    .mutation(({ ctx, input }) => callUseCase(processPendingUseCase({ ...input, log: ctx.log }))),
});
