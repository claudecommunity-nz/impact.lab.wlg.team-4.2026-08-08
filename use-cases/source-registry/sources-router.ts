import { z } from "zod";
import { publicProcedure, router } from "@/trpc/init";
import { SourceRegistryEntrySchema } from "@/repositories/source-registry/source-registry-schema";
import { callUseCase } from "@/utilities/call-use-case";
import { getSourceRegistryUseCase } from "./get-source-registry-use-case";
import { seedSourceRegistryUseCase } from "./seed-source-registry-use-case";
import { upsertSourceRegistryUseCase } from "./upsert-source-registry-use-case";

/**
 * Who we trust, and how much — readable and editable at runtime.
 *
 * Published rather than kept private on purpose: an operator watching a real
 * event learns which accounts are reliable long before we do, and the cost of
 * making them wait for a deploy to record that is measured in minutes of
 * response time. `list` is also the honest answer to "why did this grade F?".
 */
export const sourcesRouter = router({
  list: publicProcedure
    .input(z.object({ sourceIds: z.array(z.string()).optional() }))
    .output(z.array(SourceRegistryEntrySchema))
    .query(({ ctx, input }) => callUseCase(getSourceRegistryUseCase({ ...input, log: ctx.log }))),

  seed: publicProcedure
    .input(z.object({}))
    .output(z.object({ seeded: z.number().int(), entries: z.array(SourceRegistryEntrySchema) }))
    .mutation(({ ctx }) => callUseCase(seedSourceRegistryUseCase({ log: ctx.log }))),

  upsert: publicProcedure
    .input(upsertSourceRegistryUseCase.inputSchema)
    .output(z.array(SourceRegistryEntrySchema))
    .mutation(({ ctx, input }) => callUseCase(upsertSourceRegistryUseCase({ ...input, log: ctx.log }))),
});
