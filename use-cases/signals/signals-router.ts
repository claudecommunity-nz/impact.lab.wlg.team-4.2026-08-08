import { z } from "zod";
import { publicProcedure, router } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import { IngestBatchResultSchema, ingestBatchUseCase } from "./ingest-batch-use-case";
import { IngestSignalResultSchema, ingestSignalUseCase } from "./ingest-signal-use-case";

/**
 * The intake boundary — the PUSH half of the universal intake (the PULL half is
 * workflows/inbox-poller.ts, which calls the same use cases).
 *
 * The input schemas are deliberately open: any JSON object is a valid payload,
 * because making other teams learn our schema before they can send us anything
 * is how integrations die on a hackathon day. Shape is the adapter's problem.
 *
 * See INTEGRATION.md for working curl examples.
 */
export const signalsRouter = router({
  ingest: publicProcedure
    .input(z.record(z.string(), z.unknown()))
    .output(IngestSignalResultSchema)
    .mutation(({ ctx, input }) => callUseCase(ingestSignalUseCase({ payload: input, log: ctx.log }))),

  ingestBatch: publicProcedure
    // Items are `unknown`, not objects: a bad item must be reportable per item,
    // never a 400 that rejects the whole batch.
    .input(z.object({ items: z.array(z.unknown()) }))
    .output(IngestBatchResultSchema)
    .mutation(({ ctx, input }) => callUseCase(ingestBatchUseCase({ ...input, log: ctx.log }))),
});
