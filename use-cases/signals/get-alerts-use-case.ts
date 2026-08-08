import { z } from "zod";
import { DATASET_LIVE, GradeSchema } from "@/db/vocabulary";
import { getGradeEventsUseCase } from "@/use-cases/grade-events/get-grade-events-use-case";
import { createUseCase } from "@/utilities/create-use-case";

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
 * **This returns [] today, and that is the honest answer, not a stub with the
 * lights off.** The grading module currently in place is a placeholder that
 * never sets `alertWorthy` (it says so in every `reasons` array it writes), so
 * no transition has ever fired an alert. The query below is real, and the feed
 * fills itself the moment the rule table lands in phase B — no shape change,
 * no second endpoint, nothing for a client to migrate.
 */
export const AlertSchema = z.object({
  /** The cluster — the PRD's "signal". */
  signalId: z.uuid(),
  datasetId: z.string(),
  /** When the transition that fired this alert was recorded. */
  at: z.date(),
  /** What kind of thing is being reported. Null until issue extraction lands. */
  issueType: z.string().nullable(),
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

    log?.info(
      { datasetId: dataset, since: since.toISOString(), alerts: events.data.length },
      "Served the alert feed",
    );

    return success(
      events.data.map((event) => ({
        signalId: event.groupId,
        datasetId: event.datasetId,
        at: event.at,
        issueType: null,
        location: null,
        grade: event.toGrade,
        alertReasons: event.alertReasons ?? [],
        independentSources: event.independentSources,
        itemCount: event.itemCount,
      })),
    );
  },
);
