import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { IngestSignalResultSchema, ingestSignalUseCase } from "./ingest-signal-use-case";

export const IngestBatchResultSchema = z.object({
  total: z.number().int(),
  created: z.number().int(),
  deduped: z.number().int(),
  failed: z.number().int(),
  /** One entry per submitted item, in submission order. */
  results: z.array(
    z.object({
      index: z.number().int(),
      ok: z.boolean(),
      signal: IngestSignalResultSchema.optional(),
      error: z.string().optional(),
    }),
  ),
});

export type IngestBatchResult = z.infer<typeof IngestBatchResultSchema>;

/**
 * Batch intake with PARTIAL SUCCESS: one malformed item never sinks the batch.
 *
 * This is the deliberate exception to "check .error and propagate" — here a
 * failed item IS the result for that item. The batch itself only fails if
 * something outside the loop breaks. Senders get a per-item verdict and can
 * fix or re-send just the items that failed.
 *
 * Sequential on purpose: dedupe must see rows written moments earlier in the
 * same batch.
 */
export const ingestBatchUseCase = createUseCase(
  {
    id: "ingest-batch",
    inputSchema: z.object({
      /** ANY JSON values — items that are not readable come back as failures. */
      items: z.array(z.unknown()),
    }),
    outputSchema: IngestBatchResultSchema,
  },
  async ({ success }, { items, log }) => {
    const results: IngestBatchResult["results"] = [];
    let created = 0;
    let deduped = 0;
    let failed = 0;

    for (const [index, payload] of items.entries()) {
      const result = await ingestSignalUseCase({ payload, log });

      if (result.error) {
        failed += 1;
        results.push({ index, ok: false, error: result.error.message });
        continue;
      }

      if (result.data.created) created += 1;
      else deduped += 1;
      results.push({ index, ok: true, signal: result.data });
    }

    log?.info({ total: items.length, created, deduped, failed }, "Ingest batch completed");

    return success({ total: items.length, created, deduped, failed, results });
  },
);
