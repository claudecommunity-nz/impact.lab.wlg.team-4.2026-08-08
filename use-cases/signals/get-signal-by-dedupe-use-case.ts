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
      source: z.string().min(1),
      text: z.string().min(1),
      occurredAt: z.date(),
    }),
    outputSchema: SignalSchema.nullable(),
  },
  async ({ success }, { source, text, occurredAt }) => {
    const signal = await getSignalByDedupeRepo({ db, source, text, occurredAt });
    return success(signal);
  },
);
