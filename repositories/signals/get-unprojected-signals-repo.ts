import { and, asc, eq, isNotNull, notExists } from "drizzle-orm";
import { signalVectors, signals, type Db } from "@/db";
import { type Signal } from "./signal-schema";

/**
 * The projection verb's work queue: embedded signals with no coordinates yet in
 * this basis. "Not yet projected" is a left-join miss, which is why the
 * coordinates live in their own table.
 */
export async function getUnprojectedSignalsRepo(args: {
  db: Db;
  kind: string;
  limit: number;
}): Promise<Signal[]> {
  return args.db
    .select()
    .from(signals)
    .where(
      and(
        isNotNull(signals.embedding),
        notExists(
          args.db
            .select({ signalId: signalVectors.signalId })
            .from(signalVectors)
            .where(
              and(eq(signalVectors.signalId, signals.id), eq(signalVectors.kind, args.kind)),
            ),
        ),
      ),
    )
    .orderBy(asc(signals.occurredAt), asc(signals.source), asc(signals.text))
    .limit(args.limit);
}
