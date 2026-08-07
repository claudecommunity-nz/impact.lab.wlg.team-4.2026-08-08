import { and, eq, inArray } from "drizzle-orm";
import { signalVectors, type Db } from "@/db";
import { type SignalVector } from "./signal-vector-schema";

/**
 * Coordinates for a page of signals in one basis. A signal with no row here is
 * not an error: it simply has not been projected yet (the basis is fitted once,
 * after enough signals exist), so callers must tolerate a missing vec3.
 */
export async function getSignalVectorsRepo(args: {
  db: Db;
  kind: string;
  signalIds: string[];
}): Promise<SignalVector[]> {
  if (args.signalIds.length === 0) return [];
  return args.db
    .select()
    .from(signalVectors)
    .where(
      and(eq(signalVectors.kind, args.kind), inArray(signalVectors.signalId, args.signalIds)),
    );
}
