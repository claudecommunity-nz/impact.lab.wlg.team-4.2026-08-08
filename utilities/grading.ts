import {
  DEFAULT_SOURCE_RELIABILITY,
  SOURCE_RELIABILITY,
  SOURCE_RELIABILITY_LABELS,
  renderGradeLabel,
  type Grade,
  type SourceReliability,
} from "@/db/vocabulary";
import { DEFAULT_ISSUE_TYPE, halfLifeHours, type IssueType } from "@/utilities/issue-type";

/**
 * The Admiralty rule table. Pure — no db, no HTTP, no clock (`now` is a
 * parameter, like `log` is elsewhere), no zod, no logging.
 *
 * Facts in, a grade and the ordered sentences behind it out. Everything that
 * needed a database to discover — how many independent origins, which sources,
 * whether an authoritative layer agrees — has already been discovered by the
 * caller and arrives here as `ClusterFacts`. That seam is what makes the rules
 * testable in milliseconds without a server, and what makes a replayed fixture
 * grade identically on any machine on any day.
 *
 * Two axes, never blended. "A reliable source said something we cannot
 * corroborate" and "an unknown source said something three others confirm" are
 * different states, and a single confidence percentage would erase exactly that
 * distinction — which is the false precision this whole module exists to
 * refuse (convergence Decision 3, PRD AC14.3).
 *
 * The rules, in the order they are tested:
 *
 * | # | credibility | when |
 * |---|---|---|
 * | 6 | truth cannot be judged | location or time unresolvable |
 * | 5 | improbable | contradicted by another origin or by telemetry |
 * | 2 | probably true | 2+ independent origins AND a consistent authoritative cross-check |
 * | 3 | possibly true | either of those alone |
 * | 4 | doubtful | a single origin, nothing agreeing with it |
 *
 * Credibility **1 ("confirmed by other sources") is unreachable**: `toGrade`
 * throws rather than write it. That is not a lint rule, it is the product —
 * confirmation is a human's word, and a system that could type it would
 * eventually be read as having said it.
 */

/** The credibility a machine may never assert. See `toGrade`. */
export const MACHINE_FORBIDDEN_CREDIBILITY = 1;

/** The floor an A-reliability source lifts a poorly-corroborated cluster to (AC19.1). */
export const A_SOURCE_CREDIBILITY_FLOOR = 3;

/** A → 0 … F → 5. Lower is better, so `best` is a `Math.min` over this. */
const RELIABILITY_RANK: Record<SourceReliability, number> = SOURCE_RELIABILITY.reduce(
  (acc, letter, index) => ({ ...acc, [letter]: index }),
  {} as Record<SourceReliability, number>,
);

export type HazardCrossCheckResult = "consistent" | "inconsistent" | "no_applicable_layer";

export type HazardCrossCheck = {
  result: HazardCrossCheckResult;
  /** What was actually checked, in words. Reproduced verbatim in `reasons` (AC20.3). */
  detail?: string;
};

/** Whether we know WHERE. `stated` = a source gave coordinates; `inferred` = we derived them. */
export type LocationCertainty = "stated" | "inferred" | "unknown";

/**
 * Whether we know WHEN. `assumed` means the collector sent no timestamp and
 * ingest defaulted it — a weakness worth saying out loud, but not the same as
 * having no idea, so it does not on its own make a cluster unjudgeable.
 */
export type TimeCertainty = "stated" | "assumed" | "unknown";

/**
 * Everything the rule table needs, and nothing it could look up itself.
 * The contract in docs/convergence.md, plus three additive fields the fold can
 * supply honestly today (`bestSourceId`, `timeCertainty`, `issueType`).
 */
export type ClusterFacts = {
  /** Distinct origins from `utilities/origin-fingerprint.ts`. Never the item count. */
  independentOrigins: number;
  itemCount: number;
  /** Best (lowest-lettered) reliability among contributing sources. Absent → F. */
  bestSourceReliability: SourceReliability;
  /** Which source earned it, so the reason line can name the evidence. */
  bestSourceId?: string | null;
  /**
   * How many distinct contributing sources are in the registry, and how many
   * are not. The A–F axis is "the BEST source here" (AC15.3), so one official
   * note among twenty anonymous posts makes the whole cluster read A — which is
   * the rule the PRD asks for, and is badly misleading unless the proportion is
   * printed beside it. These two numbers are how the reason stays honest.
   */
  registeredSourceCount?: number;
  unregisteredSourceCount?: number;
  hazardCrossCheck: HazardCrossCheck;
  locationCertainty: LocationCertainty;
  timeCertainty?: TimeCertainty;
  /**
   * Origins that actively CONTRADICT the cluster's claim. Zero today: nothing
   * in the pipeline writes `contradicts` edges yet, and inventing a number here
   * would be worse than reporting the one we can defend. The rule is live and
   * proven, waiting for the edge.
   */
  contradictingOrigins?: number;
  /** Chooses the decay rate. Absent → `other` (a 12-hour half-life). */
  issueType?: IssueType;
  firstSeen: Date;
  lastSeen: Date;
  /** Threaded, never read from a wall clock — replay depends on it. */
  now: Date;
};

export type GradeVerdict = {
  grade: Grade;
  /** Ordered, most decisive first. Each entry names the evidence it used (AC18.2). */
  reasons: string[];
  /** Computed INDEPENDENTLY of the grade (AC27.1). */
  alertWorthy: boolean;
  /** The weakness of the evidence, in plain language (AC27.3). Never empty. */
  alertReasons: string[];
  /** 1 → 0 by the issue type's half-life. Reported, never a gate. */
  freshness: number;
  issueType: IssueType;
};

/**
 * The ONE place a pair of axes becomes a `Grade` — and therefore the one place
 * that can refuse.
 *
 * Every path to a published grade runs through here, which is what makes
 * "structurally incapable of marking anything confirmed" (AC17) a property of
 * the code rather than a promise in a comment. It throws rather than returning
 * an error result, deliberately: a rule that produced credibility 1 is a bug in
 * the rule table, not a bad input, and it should take the request down loudly
 * instead of degrading into something a duty officer might read.
 */
export function toGrade(reliability: SourceReliability, credibility: number): Grade {
  if (credibility === MACHINE_FORBIDDEN_CREDIBILITY) {
    throw new Error(
      'Refusing to write infoCredibility 1 ("confirmed by other sources"): confirmation is a human judgement, never a machine output (PRD AC17.1)',
    );
  }
  if (!Number.isInteger(credibility) || credibility < 2 || credibility > 6) {
    throw new Error(`Information credibility must be an integer 2–6, got ${credibility}`);
  }
  return {
    sourceReliability: reliability,
    infoCredibility: credibility,
    label: renderGradeLabel(reliability, credibility),
  };
}

/**
 * The best reliability among a cluster's sources, and who earned it (AC15.3).
 *
 * "Best" rather than average or worst: one drone feed or one official report
 * should not be dragged down by the volume of unknown accounts posting beside
 * it (AC19). A source absent from the registry is F — never a middle grade —
 * because knowing nothing about a source is not the same as knowing it to be
 * mediocre (AC15.1).
 */
export function bestSourceReliability(input: {
  sourceIds: readonly string[];
  registry: ReadonlyMap<string, SourceReliability>;
}): {
  reliability: SourceReliability;
  /** The source that earned it, or null when nothing was registered. */
  sourceId: string | null;
  registered: string[];
  unregistered: string[];
} {
  const registered: string[] = [];
  const unregistered: string[] = [];

  let reliability: SourceReliability = DEFAULT_SOURCE_RELIABILITY;
  let sourceId: string | null = null;

  // Sorted, so equally-reliable sources always produce the same reason line.
  for (const raw of [...new Set(input.sourceIds)].sort()) {
    const known = input.registry.get(raw) ?? input.registry.get(raw.trim().toLowerCase());
    if (known === undefined) {
      unregistered.push(raw);
      continue;
    }
    registered.push(raw);
    if (RELIABILITY_RANK[known] < RELIABILITY_RANK[reliability] || sourceId === null) {
      reliability = known;
      sourceId = raw;
    }
  }

  return { reliability, sourceId, registered, unregistered };
}

/**
 * How current this still is: 1 at the moment of the last report, halving every
 * `halfLifeHours` for its issue type (AC23.2).
 *
 * Decay of ATTENTION, not of truth. A flood report from six hours ago is not
 * false; it has simply stopped describing the present, because the water has
 * either risen or drained and nobody has said which. Structural damage does not
 * work that way, which is why the table spreads from 3 hours to 48 (AC23.3).
 */
export function freshness(input: { issueType?: IssueType; lastSeen: Date; now: Date }): number {
  const halfLife = halfLifeHours(input.issueType ?? DEFAULT_ISSUE_TYPE);
  const elapsedHours = (input.now.getTime() - input.lastSeen.getTime()) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) return 1;
  return clamp01(0.5 ** (elapsedHours / halfLife));
}

/** The rule table. Facts in, grade + ordered reasons + an independent alert verdict out. */
export function gradeCluster(facts: ClusterFacts): GradeVerdict {
  const issueType = facts.issueType ?? DEFAULT_ISSUE_TYPE;
  const timeCertainty: TimeCertainty = facts.timeCertainty ?? "stated";
  const contradictingOrigins = facts.contradictingOrigins ?? 0;
  const corroborated = facts.independentOrigins >= 2;
  const crossCheckAgrees = facts.hazardCrossCheck.result === "consistent";
  const contradicted = facts.hazardCrossCheck.result === "inconsistent" || contradictingOrigins > 0;

  // ─── credibility ────────────────────────────────────────────────────────────
  let credibility: number;
  let ruleReason: string;

  if (facts.locationCertainty === "unknown" || timeCertainty === "unknown") {
    credibility = 6;
    ruleReason =
      facts.locationCertainty === "unknown"
        ? `no contributing report could be placed on a map, so this cannot be judged — ${describeEvidence(facts)} with no resolvable location`
        : `no contributing report carried a resolvable time, so this cannot be judged — ${describeEvidence(facts)}`;
  } else if (contradicted) {
    credibility = 5;
    ruleReason =
      contradictingOrigins > 0
        ? `contradicted by ${contradictingOrigins} other origin${contradictingOrigins === 1 ? "" : "s"} reporting otherwise`
        : `contradicted by authoritative data: ${facts.hazardCrossCheck.detail ?? "the applicable hazard layer disagrees with this claim"}`;
  } else if (corroborated && crossCheckAgrees) {
    credibility = 2;
    ruleReason = `${describeEvidence(facts)}, AND authoritative data agrees — corroboration on both axes`;
  } else if (corroborated) {
    credibility = 3;
    ruleReason = `${describeEvidence(facts)} — independent people, not one report repeated`;
  } else if (crossCheckAgrees) {
    credibility = 3;
    ruleReason = `only one independent origin, but authoritative data agrees with it: ${facts.hazardCrossCheck.detail ?? "the applicable layer is consistent with this claim"}`;
  } else {
    credibility = 4;
    ruleReason = `${describeEvidence(facts)} and nothing yet agrees with it — uncorroborated, which is what "doubtful" means here, not "false"`;
  }

  // ─── the A-source override (AC19) ───────────────────────────────────────────
  //
  // Applied ONLY where corroboration is the binding weakness, which is what
  // "regardless of origin count" means. It deliberately does NOT lift a 5 or a
  // 6: an official source does not make a contradiction go away (AC21 wants
  // that flagged, not hidden), and it cannot tell us where something is.
  const reliability = facts.bestSourceReliability;
  const overrideReasons: string[] = [];

  if (reliability === "A" && credibility === 4) {
    credibility = A_SOURCE_CREDIBILITY_FLOOR;
    overrideReasons.push(
      `${nameSource(facts)} is registered A (completely reliable), so credibility is floored at ${A_SOURCE_CREDIBILITY_FLOOR} regardless of how few origins there are`,
    );
  } else if (reliability === "A" && credibility > A_SOURCE_CREDIBILITY_FLOOR) {
    overrideReasons.push(
      `${nameSource(facts)} is registered A, but the A-source floor lifts a cluster only where corroboration is the weakness — it does not overturn ${credibility === 5 ? "a contradiction" : "an unresolvable location or time"}`,
    );
  }

  const grade = toGrade(reliability, credibility);

  // ─── the sentences behind it (AC18) ─────────────────────────────────────────
  const currency = freshness({ issueType, lastSeen: facts.lastSeen, now: facts.now });

  const reasons = [
    ruleReason,
    ...overrideReasons,
    describeCrossCheck(facts),
    describeReliability(facts),
    ...(facts.locationCertainty === "stated" ? [] : [describeLocation(facts)]),
    ...(timeCertainty === "stated" ? [] : [describeTime(timeCertainty)]),
    describeFreshness({ issueType, currency, facts }),
  ];

  // ─── alert-worthiness, computed independently of all of the above ───────────
  //
  // The PRD's most important behaviour (AC27). In hour zero there are no
  // independent origins yet, so the first report of anything grades 4 — and a
  // grade-driven threshold would therefore stay silent in exactly the window a
  // duty officer is most blind. So this asks a different question: is there
  // something here worth a person's attention? Somewhere to send them, and
  // nothing authoritative saying it did not happen.
  const alertWorthy = facts.locationCertainty !== "unknown" && !contradicted;
  const alertReasons = describeAlert({ facts, alertWorthy, contradicted, corroborated, grade, currency, issueType });

  return { grade, reasons, alertWorthy, alertReasons, freshness: currency, issueType };
}

// ─── the sentences ────────────────────────────────────────────────────────────

function describeEvidence(facts: ClusterFacts): string {
  const origins = facts.independentOrigins;
  const items = facts.itemCount;
  const originsText = `${origins} independent origin${origins === 1 ? "" : "s"}`;
  const itemsText = `${items} item${items === 1 ? "" : "s"}`;
  if (items === origins) return `${originsText} behind ${itemsText}`;
  return `${originsText} behind ${itemsText} — ${items - origins} collapsed as the same observation restated`;
}

function nameSource(facts: ClusterFacts): string {
  return facts.bestSourceId ? `the source "${facts.bestSourceId}"` : "a contributing source";
}

function describeCrossCheck(facts: ClusterFacts): string {
  const detail = facts.hazardCrossCheck.detail;
  switch (facts.hazardCrossCheck.result) {
    case "consistent":
      return `authoritative cross-check: consistent${detail ? ` — ${detail}` : ""}`;
    case "inconsistent":
      return `authoritative cross-check: INCONSISTENT${detail ? ` — ${detail}` : ""}`;
    default:
      return `authoritative cross-check: no applicable layer${detail ? ` — ${detail}` : ""}, so nothing has confirmed or denied this`;
  }
}

function describeReliability(facts: ClusterFacts): string {
  const letter = facts.bestSourceReliability;
  const label = SOURCE_RELIABILITY_LABELS[letter];
  if (letter === DEFAULT_SOURCE_RELIABILITY) {
    return `source reliability F: ${facts.bestSourceId ? `"${facts.bestSourceId}" is registered F` : "no contributing source is in the registry"} — unknown, not mediocre`;
  }

  // The proportion, always, when there is one. "A" on a cluster of twenty
  // anonymous posts because one official note landed in it is the rule working
  // as specified (AC15.3) and reads as a lie unless it says so in the same
  // breath — this axis describes the BEST source, never the crowd.
  const unknown = facts.unregisteredSourceCount ?? 0;
  const known = facts.registeredSourceCount ?? 0;
  const proportion =
    unknown > 0
      ? `; this axis reports the best source, not the crowd — ${unknown} of the ${known + unknown} contributing source${known + unknown === 1 ? "" : "s"} ${unknown === 1 ? "is" : "are"} unregistered and grade F on their own`
      : "";

  return `source reliability ${letter} (${label}), earned by ${nameSource(facts)} — the best among the contributing sources${proportion}`;
}

function describeLocation(facts: ClusterFacts): string {
  return facts.locationCertainty === "inferred"
    ? "location was INFERRED from the reports rather than stated by any source — treat the point as an area"
    : "no contributing report could be placed: this signal is real evidence that cannot be drawn on a map";
}

function describeTime(timeCertainty: TimeCertainty): string {
  return timeCertainty === "assumed"
    ? "no contributing report carried its own timestamp; ingest time was assumed, so the event may be older than it looks"
    : "no contributing report carried a resolvable time";
}

function describeFreshness(input: { issueType: IssueType; currency: number; facts: ClusterFacts }): string {
  const elapsedHours = (input.facts.now.getTime() - input.facts.lastSeen.getTime()) / 3_600_000;
  const half = halfLifeHours(input.issueType);
  return `freshness ${input.currency.toFixed(2)} — ${input.issueType.replace(/_/g, " ")} halves every ${half}h and the most recent report is ${formatHours(elapsedHours)} old`;
}

function describeAlert(input: {
  facts: ClusterFacts;
  alertWorthy: boolean;
  contradicted: boolean;
  corroborated: boolean;
  grade: Grade;
  currency: number;
  issueType: IssueType;
}): string[] {
  const { facts, alertWorthy, contradicted, corroborated, grade, currency, issueType } = input;

  if (!alertWorthy) {
    return contradicted
      ? [
          "not raised: authoritative data contradicts this claim. It stays on the map and in the record — an alert is a request for attention, and this one is a request to check the contradiction first",
        ]
      : [
          "not raised: nothing here can be placed on a map, so there is nowhere to send anyone. The evidence is kept and readable in full",
        ];
  }

  const reasons = [
    `${issueType.replace(/_/g, " ")} reported at a location we can point to — worth a look now, ahead of any confirmation`,
  ];

  // The weakness, stated plainly (AC27.3). This is the sentence that makes an
  // early single-source alert safe to send: it arrives already admitting what
  // it does not know.
  if (!corroborated) {
    reasons.push(
      `WEAK EVIDENCE: ${facts.independentOrigins === 1 ? "one independent origin" : "no independent origin"} behind ${facts.itemCount} item${facts.itemCount === 1 ? "" : "s"} — this is uncorroborated, and grades ${grade.label}`,
    );
  }
  if (facts.bestSourceReliability === DEFAULT_SOURCE_RELIABILITY) {
    reasons.push(
      "WEAK EVIDENCE: no contributing source is in the registry, so their reliability cannot be judged at all",
    );
  }
  if (facts.locationCertainty === "inferred") {
    reasons.push("WEAK EVIDENCE: the location was inferred from the text, not stated by a source — search the area, not the pin");
  }
  if (facts.hazardCrossCheck.result === "no_applicable_layer") {
    reasons.push("WEAK EVIDENCE: no authoritative layer applies to this claim, so nothing independent has checked it");
  }
  if (currency < 0.5) {
    reasons.push(
      `AGEING: freshness ${currency.toFixed(2)} — the newest report is more than one ${issueType.replace(/_/g, " ")} half-life old`,
    );
  }

  return reasons;
}

function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0m";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
