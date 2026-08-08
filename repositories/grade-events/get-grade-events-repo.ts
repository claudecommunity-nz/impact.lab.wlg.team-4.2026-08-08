import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { gradeEvents, type Db } from "@/db";
import { type GradeEvent } from "./grade-event-schema";

/**
 * The history, filtered three ways because three callers need it:
 *   - `groupIds` → one cluster's ordered history for `signals.detail`;
 *   - `asAt` → the grade AS AT an instant is the last event at or before it;
 *   - `since` + `alertFired` → the alert feed a duty officer polls.
 */
export async function getGradeEventsRepo(args: {
  db: Db;
  groupIds?: string[];
  datasetId?: string;
  /** Events at or before this instant — the time-scrub filter. */
  asAt?: Date;
  /** Events strictly after this instant — the alert feed's cursor. */
  since?: Date;
  alertFiredOnly?: boolean;
  /** Oldest-first is a history; newest-first is a feed. */
  order?: "asc" | "desc";
  limit?: number;
}): Promise<GradeEvent[]> {
  if (args.groupIds !== undefined && args.groupIds.length === 0) return [];

  const filters = [
    args.groupIds ? inArray(gradeEvents.groupId, args.groupIds) : undefined,
    args.datasetId ? eq(gradeEvents.datasetId, args.datasetId) : undefined,
    args.asAt ? lte(gradeEvents.at, args.asAt) : undefined,
    args.since ? gt(gradeEvents.at, args.since) : undefined,
    args.alertFiredOnly ? eq(gradeEvents.alertFired, true) : undefined,
  ].filter((f) => f !== undefined);

  const ordered = args.order === "desc" ? desc(gradeEvents.at) : asc(gradeEvents.at);

  const rows = await args.db
    .select()
    .from(gradeEvents)
    .where(filters.length === 0 ? undefined : and(...filters))
    // `id` tiebreaks: two events written in the same millisecond must still come
    // back in a fixed order, or a history reads differently on two calls.
    .orderBy(ordered, args.order === "desc" ? desc(gradeEvents.id) : asc(gradeEvents.id))
    .limit(args.limit ?? 500);

  return rows as GradeEvent[];
}
