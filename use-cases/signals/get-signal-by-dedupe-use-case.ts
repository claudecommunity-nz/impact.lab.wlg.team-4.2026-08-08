import { z } from "zod";
import { db } from "@/db";
import { getSignalByDedupeRepo } from "@/repositories/signals/get-signal-by-dedupe-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the ONLY caller of getSignalByDedupeRepo.
 *
 * Deliberately NOT wrapped in the per-request server cache: this is a read on
 * the WRITE path, and a batch that carries the same item twice must see the row
 * the first item just inserted. Cached staleness here would create duplicates,
 * which is exactly what dedupe exists to prevent.
 */
export const getSignalByDedupeUseCase = createUseCase(
  {
    id: "get-signal-by-dedupe",
    inputSchema: z.object({
      datasetId: z.string().min(1),
      source: z.string().min(1),
      text: z.string().min(1),
      occurredAt: z.date(),
      /** Present = the strong key wins and text/occurredAt are not consulted. */
      externalId: z.string().optional(),
    }),
    outputSchema: SignalSchema.nullable(),
  },
  async ({ success }, { datasetId, source, text, occurredAt, externalId }) => {
    const signal = await getSignalByDedupeRepo({
      db,
      datasetId,
      source,
      text,
      occurredAt,
      externalId,
    });
    return success(signal);
  },
);
