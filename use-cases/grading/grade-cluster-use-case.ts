import { z } from "zod";
import {
  DEFAULT_SOURCE_RELIABILITY,
  GRADING_STUB_REASON,
  GradeSchema,
  renderGradeLabel,
} from "@/db/vocabulary";
import { getGroupUseCase } from "@/use-cases/groups/get-group-use-case";
import { updateGroupUseCase } from "@/use-cases/groups/update-group-use-case";
import { createGradeEventUseCase } from "@/use-cases/grade-events/create-grade-event-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Grade one cluster and record the transition. **PLACEHOLDER — phase A.**
 *
 * This is the SEAM, not the logic. It exists now so that the sync fold in
 * `signals.ingest` (convergence Decision 2) is complete end to end and every
 * published surface already carries a grade, ordered reasons, an alert flag and
 * an append-only history. Phase B replaces the constant below with the pure
 * `utilities/grading.ts` rule table and `utilities/origin-fingerprint.ts`, and
 * nothing above this file changes.
 *
 * Until then it says so, in the reasons array, on every single response. A
 * placeholder that looked like a verdict would be worse than no grade at all —
 * this whole system exists to stop unearned confidence travelling.
 *
 * What it deliberately does NOT do, and will not do when it is real:
 *   - write `infoCredibility: 1`. "Confirmed by other sources" is a human's
 *     word. The real module throws if a rule ever produces it, and
 *     `groups.confirmed_by` is only ever set by a person.
 *   - blend anything into a single confidence number (Decision 3).
 *   - read a wall clock: `now` is threaded in like `log`, because replaying a
 *     historical fixture must grade identically whatever today's date is.
 */

/** What the placeholder always returns: one origin, doubtful, unknown source. */
export const STUB_INFO_CREDIBILITY = 4;

export const GradeClusterResultSchema = z.object({
  groupId: z.uuid(),
  grade: GradeSchema,
  reasons: z.array(z.string()),
  /** Computed INDEPENDENTLY of the grade — see the module note in convergence.md. */
  alertWorthy: z.boolean(),
  alertReasons: z.array(z.string()),
  /** Distinct origins. A placeholder until origin fingerprinting lands. */
  independentSources: z.number().int(),
  itemCount: z.number().int(),
  /** True when this call appended a grade event (the grade actually moved). */
  transitioned: z.boolean(),
});

export type GradeClusterResult = z.infer<typeof GradeClusterResultSchema>;

export const gradeClusterUseCase = createUseCase(
  {
    id: "grade-cluster",
    inputSchema: z.object({
      groupId: z.uuid(),
      /** Threaded, never read from a clock inside grading. */
      now: z.date(),
    }),
    outputSchema: GradeClusterResultSchema,
  },
  async ({ success, error }, { groupId, now, log }) => {
    const group = await getGroupUseCase({ id: groupId, log });
    if (group.error) return error(group.error);
    if (!group.data) return error({ message: `Group ${groupId} not found`, kind: "not_found" });

    const members = await getSignalsForGroupUseCase({ groupId, log });
    if (members.error) return error(members.error);

    const itemCount = members.data.length;

    // ─── the placeholder verdict ──────────────────────────────────────────────
    const grade = {
      sourceReliability: DEFAULT_SOURCE_RELIABILITY,
      infoCredibility: STUB_INFO_CREDIBILITY,
      label: renderGradeLabel(DEFAULT_SOURCE_RELIABILITY, STUB_INFO_CREDIBILITY),
    };
    const reasons = [
      GRADING_STUB_REASON,
      `single origin assumed: origin fingerprinting is not wired yet, so independentSources is reported as 1 regardless of the ${itemCount} item${itemCount === 1 ? "" : "s"} in this cluster`,
      "source reliability defaults to F: the registry lookup lands with the rule table",
    ];
    const independentSources = 1;
    const alertWorthy = false;
    const alertReasons: string[] = [];

    // ─── persist, and record the transition if there was one ──────────────────
    const previous = group.data.grade;
    const transitioned =
      previous === null ||
      previous.sourceReliability !== grade.sourceReliability ||
      previous.infoCredibility !== grade.infoCredibility;

    const updated = await updateGroupUseCase({
      id: groupId,
      grade,
      reasons,
      alertWorthy,
      log,
    });
    if (updated.error) return error(updated.error);

    if (transitioned) {
      // Append only. An alert fires on a TRANSITION, not on a state, so the
      // thing that fires has to be a record rather than a column read.
      const event = await createGradeEventUseCase({
        groupId,
        datasetId: group.data.datasetId,
        fromGrade: previous,
        toGrade: grade,
        at: now,
        independentSources,
        itemCount,
        reasons,
        alertFired: alertWorthy,
        alertReasons: alertWorthy ? alertReasons : null,
        log,
      });
      if (event.error) return error(event.error);
    }

    log?.info(
      { groupId, grade: grade.label, itemCount, independentSources, transitioned, stub: true },
      "Cluster graded by the PLACEHOLDER grader — reasons say so",
    );

    return success({
      groupId,
      grade,
      reasons,
      alertWorthy,
      alertReasons,
      independentSources,
      itemCount,
      transitioned,
    });
  },
);
