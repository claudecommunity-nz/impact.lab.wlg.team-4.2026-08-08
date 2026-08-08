import { z } from "zod";
import { DATASET_LIVE, GradeSchema } from "@/db/vocabulary";
import { type Signal } from "@/repositories/signals/signal-schema";
import { getGradeEventsUseCase } from "@/use-cases/grade-events/get-grade-events-use-case";
import { getSignalsForGroupsUseCase } from "@/use-cases/signals/get-signals-for-groups-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { classifyIssueType, ISSUE_TYPES } from "@/utilities/issue-type";
import { locate } from "./get-signals-geojson-use-case";

/**
 * What a duty officer has missed since they last looked.
 *
 * **Alerts are TRANSITIONS, not states** (AC28.1). Polling a "currently
 * alert-worthy" list would re-deliver the same three events every thirty
 * seconds until they were dismissed, and a feed that repeats itself is a feed
 * people stop reading. So the source of truth is the append-only grade event
 * log, filtered to the entries that actually fired, after a cursor the caller
 * holds.
 *
 * The thing that fires them is deliberately NOT the grade. A grade-driven
 * threshold would stay silent for the whole of hour zero — the first report of
 * anything is a single source and grades "doubtful" — which is exactly the
 * window a duty officer is most blind in. So `alertWorthy` is decided on its
 * own terms ("is there somewhere to send someone, and is anything authoritative
 * saying it did not happen?"), and a weak early signal arrives WITH its
 * weakness written into `alertReasons` (AC27).
 */
export const AlertSchema = z.object({
  /** The cluster — the PRD's "signal". */
  signalId: z.uuid(),
  datasetId: z.string(),
  /** When the transition that fired this alert was recorded. */
  at: z.date(),
  /** What kind of thing is being reported, from the words the reports used. */
  issueType: z.enum(ISSUE_TYPES),
  /** Where, in WGS84, or null when the cluster cannot be placed. */
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  grade: GradeSchema,
  /**
   * Why this is worth waking someone for — computed INDEPENDENTLY of the grade,
   * so an early single-source report alerts WITH its weakness stated rather
   * than being silenced by a threshold in exactly the hour it matters most.
   */
  alertReasons: z.array(z.string()),
  independentSources: z.number().int(),
  itemCount: z.number().int(),
});

export type Alert = z.infer<typeof AlertSchema>;

export const getAlertsUseCase = createUseCase(
  {
    id: "get-alerts",
    inputSchema: z.object({
      /** The cursor: alerts raised strictly after this instant. */
      since: z.date(),
      datasetId: z.string().min(1).optional(),
      limit: z.number().int().positive().max(200).optional(),
    }),
    outputSchema: z.array(AlertSchema),
  },
  async ({ success, error }, { since, datasetId, limit, log }) => {
    const dataset = datasetId ?? DATASET_LIVE;

    const events = await getGradeEventsUseCase({
      datasetId: dataset,
      since,
      alertFiredOnly: true,
      // Most recent first (AC29.3): the thing that just happened is the thing
      // a duty officer needs at the top of the list.
      order: "desc",
      limit: limit ?? 100,
      log,
    });
    if (events.error) return error(events.error);
    if (events.data.length === 0) {
      log?.info({ datasetId: dataset, since: since.toISOString(), alerts: 0 }, "Served the alert feed");
      return success([]);
    }

    // An alert with no WHAT and no WHERE is a notification, not intelligence:
    // the two questions a duty officer asks first are "what is it" and "where",
    // and both are answerable from the items behind the cluster. Read once for
    // the whole page rather than per alert.
    const members = await getSignalsForGroupsUseCase({
      groupIds: [...new Set(events.data.map((e) => e.groupId))],
      log,
    });
    if (members.error) return error(members.error);

    const itemsByGroup = new Map<string, Signal[]>();
    for (const row of members.data) {
      const existing = itemsByGroup.get(row.groupId);
      if (existing) existing.push(row.signal);
      else itemsByGroup.set(row.groupId, [row.signal]);
    }

    log?.info(
      { datasetId: dataset, since: since.toISOString(), alerts: events.data.length },
      "Served the alert feed",
    );

    return success(
      events.data.map((event) => {
        const items = itemsByGroup.get(event.groupId) ?? [];
        const placed = locate(items);
        return {
          signalId: event.groupId,
          datasetId: event.datasetId,
          at: event.at,
          issueType: classifyIssueType(items.map((i) => i.text)),
          location: placed ? { lat: placed.lat, lng: placed.lng } : null,
          grade: event.toGrade,
          alertReasons: event.alertReasons ?? [],
          // Both figures come from the EVENT, not from a recount: they are what
          // was true when this alert fired, and re-deriving them now would
          // quietly rewrite the record a decision was taken against.
          independentSources: event.independentSources,
          itemCount: event.itemCount,
        };
      }),
    );
  },
);
