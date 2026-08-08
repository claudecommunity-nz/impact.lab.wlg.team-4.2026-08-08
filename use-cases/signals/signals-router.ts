import { z } from "zod";
import { publicProcedure, router } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import { AlertSchema, getAlertsUseCase } from "./get-alerts-use-case";
import { SignalDetailSchema, getSignalDetailUseCase } from "./get-signal-detail-use-case";
import {
  BboxSchema,
  FeatureCollectionSchema,
  GEOJSON_LIMIT,
  getSignalsGeojsonUseCase,
} from "./get-signals-geojson-use-case";
import { IngestBatchResultSchema, ingestBatchUseCase } from "./ingest-batch-use-case";
import { IngestSignalResultSchema, ingestSignalUseCase } from "./ingest-signal-use-case";

/**
 * The published contract — the intake boundary AND the trust surface, under the
 * PRD's names (convergence Decision 1).
 *
 * "Signal" means a CLUSTER out here, and one raw item is an "item". Internally
 * the words are the other way round (`signals` rows are items, `groups` rows are
 * clusters); the translation happens in this file and nowhere else, so neither
 * vocabulary leaks into the other's territory.
 *
 * The ingest input schemas are deliberately open: any JSON object is a valid
 * payload, because making other teams learn our schema before they can send us
 * anything is how integrations die on a hackathon day. Shape is the adapter's
 * problem. See INTEGRATION.md for working curl examples of every procedure here.
 */
export const signalsRouter = router({
  // ─── intake ────────────────────────────────────────────────────────────────
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

  // ─── the trust surface ─────────────────────────────────────────────────────
  geojson: publicProcedure
    .input(
      z.object({
        datasetId: z.string().min(1).optional(),
        // `coerce` so a plain ISO string works from curl or any non-tRPC client.
        // superjson still hands us a real Date from the tRPC client; both land here.
        asAt: z.coerce.date().optional(),
        bbox: BboxSchema.optional(),
        minCredibility: z.number().int().min(1).max(6).optional(),
        limit: z.number().int().positive().max(GEOJSON_LIMIT).optional(),
      }),
    )
    .output(FeatureCollectionSchema)
    .query(({ ctx, input }) => callUseCase(getSignalsGeojsonUseCase({ ...input, log: ctx.log }))),

  detail: publicProcedure
    .input(z.object({ signalId: z.uuid() }))
    .output(SignalDetailSchema)
    .query(({ ctx, input }) => callUseCase(getSignalDetailUseCase({ ...input, log: ctx.log }))),

  alerts: publicProcedure
    .input(
      z.object({
        since: z.coerce.date(),
        datasetId: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).optional(),
      }),
    )
    .output(z.array(AlertSchema))
    .query(({ ctx, input }) => callUseCase(getAlertsUseCase({ ...input, log: ctx.log }))),
});
