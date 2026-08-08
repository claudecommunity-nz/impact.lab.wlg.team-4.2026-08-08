import { z } from "zod";
import { GradeSchema } from "@/db/vocabulary";
import { getAnnotationsForNodesUseCase } from "@/use-cases/annotations/get-annotations-for-nodes-use-case";
import { getGroupUseCase } from "@/use-cases/groups/get-group-use-case";
import { updateGroupUseCase } from "@/use-cases/groups/update-group-use-case";
import { createGradeEventUseCase } from "@/use-cases/grade-events/create-grade-event-use-case";
import { getSignalsForGroupUseCase } from "@/use-cases/signals/get-signals-for-group-use-case";
import { getSourceRegistryUseCase } from "@/use-cases/source-registry/get-source-registry-use-case";
import { clusterFactsFromItems } from "@/utilities/cluster-facts";
import { createUseCase } from "@/utilities/create-use-case";
import { gradeCluster } from "@/utilities/grading";
import { classifyIssueType, ISSUE_TYPES } from "@/utilities/issue-type";

/**
 * Grade one cluster and record the transition.
 *
 * The composition, and nothing else: this use case's whole job is to go and
 * find the facts — who said it, how many of them are actually different people,
 * where and when, what authoritative data says — and hand them to the pure rule
 * table in `utilities/grading.ts`. Every judgement lives there, testable in
 * milliseconds by `npm run proof:grading` with no database and no clock.
 *
 * Read it as three moves:
 *
 *   1. **gather** — members, their annotations, the source registry;
 *   2. **fingerprint** — collapse the items that are the same observation
 *      restated (`utilities/origin-fingerprint.ts`), because the number that
 *      matters is independent ORIGINS and everything about the internet
 *      manufactures apparent corroboration out of one observation;
 *   3. **grade, persist, and record the transition** — the groups row carries
 *      the current verdict, `grade_events` carries every verdict there has ever
 *      been, append-only, because an alert fires on a TRANSITION rather than a
 *      state and because `asAt` means "the last event at or before then".
 *
 * What it will never do:
 *   - write `infoCredibility: 1`. `toGrade` throws instead, so "confirmed" is
 *     unreachable by code rather than merely discouraged (AC17), and
 *     `groups.confirmed_by` is only ever set by a person;
 *   - blend anything into a single confidence number (Decision 3);
 *   - read a wall clock. `now` is threaded in like `log`, because replaying a
 *     historical fixture must grade identically whatever today's date is.
 */

export const GradeClusterResultSchema = z.object({
  groupId: z.uuid(),
  grade: GradeSchema,
  reasons: z.array(z.string()),
  /** Computed INDEPENDENTLY of the grade — see the module note in convergence.md. */
  alertWorthy: z.boolean(),
  alertReasons: z.array(z.string()),
  /** Distinct ORIGINS behind the cluster. Never the item count. */
  independentSources: z.number().int(),
  itemCount: z.number().int(),
  /** originId → the itemIds that trace back to that one observation. */
  originGroups: z.array(z.object({ originId: z.string(), itemIds: z.array(z.uuid()) })),
  /** What kind of problem this is, which is also what chose the decay rate. */
  issueType: z.enum(ISSUE_TYPES),
  /** 1 → 0 by that type's half-life. Reported, never a gate on anything. */
  freshness: z.number(),
  /** True when this call appended a grade event (the verdict actually moved). */
  transitioned: z.boolean(),
  /** True when that transition raised an alert. Alerts are transitions, not states. */
  alertFired: z.boolean(),
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
    // ─── 1. gather ────────────────────────────────────────────────────────────
    const group = await getGroupUseCase({ id: groupId, log });
    if (group.error) return error(group.error);
    if (!group.data) return error({ message: `Group ${groupId} not found`, kind: "not_found" });

    const members = await getSignalsForGroupUseCase({ groupId, log });
    if (members.error) return error(members.error);

    const items = members.data;
    if (items.length === 0) {
      // A cluster with no evidence has nothing to grade, and grading it anyway
      // would put a verdict on the map with nothing behind it (AC33.2).
      return error({ message: `Group ${groupId} has no members to grade`, kind: "no_evidence" });
    }

    // Whether the collector told us WHEN, or ingest assumed it. The annotation
    // is written at intake precisely so this question stays answerable.
    const annotations = await getAnnotationsForNodesUseCase({ nodeIds: items.map((i) => i.id), log });
    if (annotations.error) return error(annotations.error);

    const registry = await getSourceRegistryUseCase({
      sourceIds: [...new Set(items.map((i) => i.source))],
      log,
    });
    if (registry.error) return error(registry.error);

    // ─── 2. fingerprint + assemble the facts ──────────────────────────────────
    const { facts, originGroups, reliability } = clusterFactsFromItems({
      items,
      annotations: annotations.data,
      registry: new Map(registry.data.map((entry) => [entry.sourceId, entry.reliability])),
      issueType: classifyIssueType(items.map((i) => i.text)),
      now,
    });

    // ─── 3. grade ─────────────────────────────────────────────────────────────
    // Throws only if a rule ever produced credibility 1, which is a bug in the
    // rule table rather than a bad input; createUseCase turns it into an error
    // result so the fold degrades loudly instead of publishing something wrong.
    const verdict = gradeCluster(facts);

    const previous = group.data.grade;
    const gradeMoved =
      previous === null ||
      previous.sourceReliability !== verdict.grade.sourceReliability ||
      previous.infoCredibility !== verdict.grade.infoCredibility;
    // A cluster that becomes alert-worthy without its grade moving (a location
    // finally resolved, say) is new information too — and an alert that could
    // only ride on a grade change would miss it.
    const becameAlertWorthy = verdict.alertWorthy && !group.data.alertWorthy;
    const transitioned = gradeMoved || becameAlertWorthy;
    const alertFired = transitioned && verdict.alertWorthy;

    const updated = await updateGroupUseCase({
      id: groupId,
      grade: verdict.grade,
      reasons: verdict.reasons,
      alertWorthy: verdict.alertWorthy,
      log,
    });
    if (updated.error) return error(updated.error);

    if (transitioned) {
      const event = await createGradeEventUseCase({
        groupId,
        datasetId: group.data.datasetId,
        fromGrade: previous,
        toGrade: verdict.grade,
        at: now,
        independentSources: facts.independentOrigins,
        itemCount: facts.itemCount,
        reasons: verdict.reasons,
        alertFired,
        alertReasons: alertFired ? verdict.alertReasons : null,
        log,
      });
      if (event.error) return error(event.error);
    }

    log?.info(
      {
        groupId,
        grade: verdict.grade.label,
        itemCount: facts.itemCount,
        independentSources: facts.independentOrigins,
        issueType: verdict.issueType,
        freshness: Number(verdict.freshness.toFixed(3)),
        locationCertainty: facts.locationCertainty,
        bestSource: reliability.sourceId,
        transitioned,
        alertFired,
      },
      "Cluster graded",
    );

    return success({
      groupId,
      grade: verdict.grade,
      reasons: verdict.reasons,
      alertWorthy: verdict.alertWorthy,
      alertReasons: verdict.alertReasons,
      independentSources: facts.independentOrigins,
      itemCount: facts.itemCount,
      originGroups: originGroups.map(({ originId, itemIds }) => ({ originId, itemIds })),
      issueType: verdict.issueType,
      freshness: verdict.freshness,
      transitioned,
      alertFired,
    });
  },
);
