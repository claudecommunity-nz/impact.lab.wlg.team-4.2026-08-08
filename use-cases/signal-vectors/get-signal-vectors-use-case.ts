import { z } from "zod";
import { db } from "@/db";
import { getSignalVectorsRepo } from "@/repositories/signal-vectors/get-signal-vectors-repo";
import { SignalVectorSchema } from "@/repositories/signal-vectors/signal-vector-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — galaxy coordinates for a page of signals. A missing row
 * is normal (not yet projected), so callers map by signalId and tolerate null.
 * Cached per request: the points read and the groups read ask for overlapping
 * id sets and should not pay twice.
 */
export const getSignalVectorsUseCase = createUseCase(
  {
    id: "get-signal-vectors",
    inputSchema: z.object({ kind: z.string(), signalIds: z.array(z.uuid()) }),
    outputSchema: z.array(SignalVectorSchema),
  },
  async ({ success, queryClient }, { kind, signalIds }) => {
    const rows = await queryClient.fetchQuery({
      queryKey: ["signalVectors", kind, [...signalIds].sort()],
      queryFn: () => getSignalVectorsRepo({ db, kind, signalIds }),
    });
    return success(rows);
  },
);
