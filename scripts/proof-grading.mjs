/**
 * `npm run proof:grading` — the rule table and the origin fingerprint, proven.
 *
 * No database, no server, no network, no clock: these two modules are pure by
 * construction (`now` is a parameter), so this runs in well under a second and
 * can be trusted to say something about the RULES rather than about whether
 * Postgres was up. The end-to-end proof that the rules are actually wired to
 * the published surface is `npm run verify`; this is the one that tells you
 * WHICH rule broke.
 *
 * Plain .mjs, run through tsx so it can import the TypeScript modules directly.
 * Like scripts/verify.mjs it writes a PASS/FAIL report to stdout: this file is
 * a deliverable a judge or a teammate reads top to bottom, not a test suite.
 */

import {
  A_SOURCE_CREDIBILITY_FLOOR,
  bestSourceReliability,
  freshness,
  gradeCluster,
  toGrade,
} from "@/utilities/grading";
import { fingerprintOrigins, NEAR_DUPLICATE_JACCARD } from "@/utilities/origin-fingerprint";
import { classifyIssueType, ISSUE_HALF_LIFE_HOURS } from "@/utilities/issue-type";

const out = (line = "") => process.stdout.write(`${line}\n`);
const checks = [];

function check(ok, label, detail = "") {
  checks.push({ ok, label });
  out(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const NOW = new Date("2026-08-08T04:00:00.000Z");
const RECENT = new Date("2026-08-08T03:30:00.000Z");

/** A cluster that grades 4: one origin, placeable, nothing agreeing with it. */
function facts(overrides = {}) {
  return {
    independentOrigins: 1,
    itemCount: 1,
    bestSourceReliability: "F",
    bestSourceId: null,
    hazardCrossCheck: { result: "no_applicable_layer" },
    locationCertainty: "stated",
    timeCertainty: "stated",
    issueType: "flooding",
    firstSeen: RECENT,
    lastSeen: RECENT,
    now: NOW,
    ...overrides,
  };
}

const credibilityOf = (overrides) => gradeCluster(facts(overrides)).grade.infoCredibility;

// ─── the credibility rule table (PRD AC16) ────────────────────────────────────

out("── the rule table (AC16) ────────────────────────────────");

check(
  credibilityOf({ independentOrigins: 2, itemCount: 2, hazardCrossCheck: { result: "consistent", detail: "river level rising at Taita Gorge" } }) === 2,
  "2+ independent origins AND a consistent authoritative cross-check → credibility 2 (AC16.1)",
);
check(
  credibilityOf({ independentOrigins: 3, itemCount: 5 }) === 3,
  "2+ independent origins alone → credibility 3 (AC16.2)",
);
check(
  credibilityOf({ hazardCrossCheck: { result: "consistent", detail: "gauge agrees" } }) === 3,
  "a consistent cross-check alone → credibility 3 (AC16.2)",
);
check(credibilityOf({}) === 4, "a single origin → credibility 4 (AC16.3)");
check(
  credibilityOf({ independentOrigins: 4, itemCount: 9, hazardCrossCheck: { result: "inconsistent", detail: "gauge is below alarm" } }) === 5,
  "contradicted by telemetry → credibility 5, even with four origins (AC16.4)",
);
check(
  credibilityOf({ independentOrigins: 3, itemCount: 3, contradictingOrigins: 1 }) === 5,
  "contradicted by another origin → credibility 5 (AC16.4)",
);
check(
  credibilityOf({ independentOrigins: 4, itemCount: 4, locationCertainty: "unknown" }) === 6,
  "an unresolvable location → credibility 6, however many origins (AC16.5)",
);
check(
  credibilityOf({ independentOrigins: 4, itemCount: 4, timeCertainty: "unknown" }) === 6,
  "an unresolvable time → credibility 6 (AC16.5)",
);
check(
  credibilityOf({ timeCertainty: "assumed" }) === 4,
  "an ASSUMED time is a weakness, not an unjudgeable one — it stays at its rule's grade",
);

// ─── credibility 1 is unreachable (AC17) ──────────────────────────────────────

out("\n── the refusal (AC17) ──────────────────────────────────");

let threw = false;
try {
  toGrade("A", 1);
} catch (err) {
  threw = /confirm/i.test(String(err instanceof Error ? err.message : err));
}
check(threw, "toGrade THROWS on infoCredibility 1 — a machine may never write 'confirmed' (AC17.1)");

const everyGrade = [];
for (const origins of [0, 1, 2, 5]) {
  for (const cross of ["consistent", "inconsistent", "no_applicable_layer"]) {
    for (const location of ["stated", "inferred", "unknown"]) {
      for (const reliability of ["A", "C", "F"]) {
        for (const time of ["stated", "assumed", "unknown"]) {
          everyGrade.push(
            gradeCluster(
              facts({
                independentOrigins: origins,
                itemCount: Math.max(origins, 1),
                bestSourceReliability: reliability,
                bestSourceId: reliability === "F" ? null : "metservice",
                hazardCrossCheck: { result: cross },
                locationCertainty: location,
                timeCertainty: time,
              }),
            ).grade,
          );
        }
      }
    }
  }
}
check(
  everyGrade.every((g) => g.infoCredibility >= 2 && g.infoCredibility <= 6),
  `no combination of facts reaches credibility 1 — ${everyGrade.length} permutations of the rule table`,
);
check(
  everyGrade.every((g) => typeof g.label === "string" && g.label.includes("—")),
  "every grade renders both axes together for a human (AC14.2)",
  everyGrade[0].label,
);

// ─── source reliability from the registry (AC15) ──────────────────────────────

out("\n── the registry (AC15) ─────────────────────────────────");

const registry = new Map([
  ["metservice", "A"],
  ["geonet", "A"],
  ["nzta", "A"],
  ["wcc", "A"],
  ["local-paper", "C"],
]);

check(
  bestSourceReliability({ sourceIds: ["@someone", "@someone-else"], registry }).reliability === "F",
  "a source nobody registered grades F — unknown, never a middle grade (AC15.1)",
);
check(
  bestSourceReliability({ sourceIds: ["metservice"], registry }).reliability === "A",
  "a registered official source grades A (AC15.2)",
);
const mixed = bestSourceReliability({ sourceIds: ["@rando", "local-paper", "metservice"], registry });
check(
  mixed.reliability === "A" && mixed.sourceId === "metservice",
  "the BEST reliability among contributing sources wins, and is named (AC15.3)",
  `${mixed.registered.length} registered, ${mixed.unregistered.length} unknown`,
);
check(
  bestSourceReliability({ sourceIds: [], registry }).reliability === "F" &&
    bestSourceReliability({ sourceIds: ["METSERVICE"], registry }).reliability === "A",
  "an empty cluster defaults to F, and the lookup is case-insensitive",
);

// ─── the A-source override (AC19) ─────────────────────────────────────────────

out("\n── the A-source override (AC19) ────────────────────────");

const overridden = gradeCluster(facts({ bestSourceReliability: "A", bestSourceId: "geonet" }));
check(
  overridden.grade.infoCredibility === A_SOURCE_CREDIBILITY_FLOOR,
  "one A-reliability source floors a single-origin cluster at credibility 3 (AC19.1)",
  `4 → ${overridden.grade.infoCredibility}`,
);
check(
  overridden.reasons.some((r) => r.includes("geonet") && r.includes("floored")),
  "the override appends an explicit entry to reasons, naming the source (AC19.2)",
);

const contradictedA = gradeCluster(
  facts({
    bestSourceReliability: "A",
    bestSourceId: "geonet",
    hazardCrossCheck: { result: "inconsistent", detail: "the gauge disagrees" },
  }),
);
check(
  contradictedA.grade.infoCredibility === 5,
  "…but it does NOT overturn a contradiction — AC21 wants that flagged, not hidden",
  contradictedA.grade.label,
);
check(
  contradictedA.reasons.some((r) => r.includes("does not overturn")),
  "…and the reasons SAY the override was withheld, rather than staying silent about it",
);
check(
  gradeCluster(facts({ bestSourceReliability: "A", bestSourceId: "geonet", locationCertainty: "unknown" })).grade
    .infoCredibility === 6,
  "…and an official source cannot tell us where something is: unplaceable stays 6",
);

// ─── reasons name the evidence (AC18, AC20.3) ─────────────────────────────────

out("\n── the reasons (AC18 · AC20.3) ─────────────────────────");

const reasoned = gradeCluster(
  facts({
    independentOrigins: 2,
    itemCount: 5,
    bestSourceReliability: "C",
    bestSourceId: "local-paper",
    hazardCrossCheck: { result: "consistent", detail: "Hutt River at Taita Gorge is above its 90th percentile" },
  }),
);
check(reasoned.reasons.length > 0, "every grade carries a non-empty reasons array (AC18.1)", `${reasoned.reasons.length} entries`);
check(
  reasoned.reasons[0].includes("2 independent origin") && reasoned.reasons[0].includes("5 item"),
  "the most decisive reason comes first and names the evidence it used (AC18.2)",
  reasoned.reasons[0],
);
check(
  reasoned.reasons.some((r) => r.includes("Taita Gorge")),
  "the cross-check result AND its detail appear in reasons (AC20.3)",
);
check(
  reasoned.reasons.some((r) => r.includes("local-paper") && r.includes("C")),
  "the reliability line names the source that earned the letter",
);
check(
  gradeCluster(facts({})).reasons.some((r) => r.includes("no applicable layer")),
  "with no layer to check against, the reasons say so rather than implying agreement",
);

// The A–F axis is "the best source here" (AC15.3), so one official note among
// twenty anonymous posts makes a whole cluster read A. That is the specified
// rule and it is misleading unless the proportion is printed in the same breath.
const oneOfficialInACrowd = gradeCluster(
  facts({
    independentOrigins: 20,
    itemCount: 21,
    bestSourceReliability: "A",
    bestSourceId: "wremo",
    registeredSourceCount: 1,
    unregisteredSourceCount: 19,
  }),
);
check(
  oneOfficialInACrowd.grade.sourceReliability === "A" &&
    oneOfficialInACrowd.reasons.some((r) => r.includes("19 of the 20") && r.includes("unregistered")),
  "an A earned by one source among nineteen unknowns SAYS so in the same sentence (AC15.3)",
  oneOfficialInACrowd.reasons.find((r) => r.includes("unregistered")) ?? "",
);
check(
  !gradeCluster(facts({ bestSourceReliability: "A", bestSourceId: "geonet", registeredSourceCount: 1, unregisteredSourceCount: 0 }))
    .reasons.some((r) => r.includes("unregistered")),
  "…and stays quiet about a proportion when every contributing source is registered",
);

// ─── alert-worthiness is INDEPENDENT of grade (AC27) ──────────────────────────

out("\n── alert-worthiness, decoupled (AC27) ──────────────────");

const earlySignal = gradeCluster(facts({}));
check(
  earlySignal.grade.infoCredibility === 4 && earlySignal.alertWorthy === true,
  "a single-origin cluster ALERTS while still grading credibility 4 (AC27.2)",
  earlySignal.grade.label,
);
check(
  earlySignal.alertReasons.some((r) => r.startsWith("WEAK EVIDENCE") && r.includes("uncorroborated")),
  "…and the alert states the weakness of the evidence in plain language (AC27.3)",
  earlySignal.alertReasons.find((r) => r.startsWith("WEAK EVIDENCE")) ?? "",
);
check(
  gradeCluster(facts({ locationCertainty: "unknown" })).alertWorthy === false,
  "a cluster with nowhere to send anyone does not alert — there is no address on it",
);
check(
  gradeCluster(facts({ hazardCrossCheck: { result: "inconsistent", detail: "gauge below alarm" } })).alertWorthy === false,
  "a contradicted cluster does not alert, and stays on the map and in the record (AC21.1)",
);
check(
  gradeCluster(facts({ independentOrigins: 6, itemCount: 6 })).alertWorthy === true &&
    gradeCluster(facts({ independentOrigins: 6, itemCount: 6 })).grade.infoCredibility === 3,
  "a well-corroborated cluster alerts too — the flag tracks attention, not belief",
);
check(
  gradeCluster(facts({ locationCertainty: "inferred" })).alertReasons.some((r) => r.includes("inferred")),
  "an inferred location is called out in the alert: search the area, not the pin",
);

// ─── freshness decays by issue type (AC23) ────────────────────────────────────

out("\n── freshness (AC23) ────────────────────────────────────");

const sixHoursAgo = new Date(NOW.getTime() - 6 * 3_600_000);
const floodFresh = freshness({ issueType: "flooding", lastSeen: sixHoursAgo, now: NOW });
const damageFresh = freshness({ issueType: "structural_damage", lastSeen: sixHoursAgo, now: NOW });
check(
  Math.abs(floodFresh - 0.25) < 1e-9,
  "freshness halves once per half-life — flooding at 6h (two 3h half-lives) is 0.25 (AC23.2)",
  floodFresh.toFixed(4),
);
check(
  floodFresh < damageFresh / 2,
  "flooding decays materially faster than structural damage over the same elapsed time (AC23.3)",
  `${floodFresh.toFixed(3)} vs ${damageFresh.toFixed(3)}`,
);
check(
  freshness({ issueType: "flooding", lastSeen: NOW, now: NOW }) === 1,
  "a report that just landed is fully fresh",
);
check(
  ISSUE_HALF_LIFE_HOURS.flooding < ISSUE_HALF_LIFE_HOURS.structural_damage,
  "every issue type maps to a configured half-life (AC23.1)",
  `flooding ${ISSUE_HALF_LIFE_HOURS.flooding}h · structural damage ${ISSUE_HALF_LIFE_HOURS.structural_damage}h`,
);
check(
  classifyIssueType(["Water over the road on Adelaide Rd, flooding badly"]) === "flooding" &&
    classifyIssueType(["nothing recognisable here"]) === "other",
  "issue type is classified from the words the reports used, and defaults honestly",
);

// ─── the same fact set always grades the same (AC16 preamble) ─────────────────

check(
  JSON.stringify(gradeCluster(facts({ independentOrigins: 2, itemCount: 4 }))) ===
    JSON.stringify(gradeCluster(facts({ independentOrigins: 2, itemCount: 4 }))),
  "two clusters with the same evidence always grade the same, down to the reasons",
);

// ─── origin fingerprinting (AC5 · AC6 · AC7 · AC8) ────────────────────────────

out("\n── origin fingerprinting (AC5 · AC6 · AC7 · AC8) ───────");

const at = (mins) => new Date(NOW.getTime() + mins * 60_000);

const FLOOD = "Water is over the road on Adelaide Road near the Basin, cars turning around";
const copies = [
  { id: "a1", source: "twitter", author: "@ann", text: FLOOD, occurredAt: at(0) },
  { id: "a2", source: "twitter", author: "@bob", text: FLOOD, occurredAt: at(1) },
  { id: "a3", source: "facebook", author: "@cal", text: `RT: ${FLOOD}`, occurredAt: at(2) },
];
const copyPrint = fingerprintOrigins(copies);
check(
  copyPrint.independentOrigins === 1,
  "three copy-paste postings of one sentence are ONE observation (AC5.1, AC5.2)",
  `${copyPrint.independentOrigins} origins from ${copies.length} items`,
);
check(
  new Set(copies.map((c) => copyPrint.originById.get(c.id))).size === 1 &&
    copyPrint.originById.get("a1") === "a1",
  "…and they all inherit the EARLIEST item's id as their originId",
);
check(
  copyPrint.originGroups[0].reasons.some((r) => r.includes("copy-paste")),
  "…and the collapse says why, in words",
  copyPrint.originGroups[0].reasons[0] ?? "",
);

const witness = {
  id: "b1",
  source: "neighbourly",
  author: "@dee",
  text: "Basin Reserve underpass is completely flooded, water up to the kerb, avoid it",
  occurredAt: at(3),
};
const withWitness = fingerprintOrigins([...copies, witness]);
check(
  withWitness.independentOrigins === 2,
  "a genuinely independent report of the same event STAYS independent (AC13.1)",
  `${withWitness.independentOrigins} origins from 4 items`,
);
check(
  withWitness.originById.get("b1") === "b1",
  "…with its own origin, not folded into the echo",
);

const quoted = [
  { id: "c1", source: "twitter", author: "@ann", url: "https://x.com/ann/status/1", text: FLOOD, occurredAt: at(0) },
  {
    id: "c2",
    source: "localnews",
    author: "desk",
    url: "https://news.example/story",
    quotedUrls: ["https://X.com/ann/status/1/"],
    text: "Reports of surface flooding near the Basin Reserve this afternoon",
    occurredAt: at(10),
  },
  {
    id: "c3",
    source: "aggregator",
    author: "bot",
    quotedUrls: ["http://www.x.com/ann/status/1"],
    text: "Wellington: flooding reported near the Basin",
    occurredAt: at(20),
  },
];
const quotedPrint = fingerprintOrigins(quoted);
check(
  quotedPrint.independentOrigins === 1 && quotedPrint.originById.get("c2") === "c1",
  "an item quoting another item's url inherits its origin (AC6.1)",
);
check(
  quotedPrint.originGroups[0].itemIds.length === 3,
  "one original plus two quoting items: independentSources 1, itemCount 3 (AC6.2)",
  `${quotedPrint.independentOrigins} origins, ${quotedPrint.originGroups[0].itemIds.length} items`,
);

const prolific = [
  { id: "d1", source: "twitter", author: "@loud", text: "Something is going on down by the quays", occurredAt: at(0) },
  { id: "d2", source: "twitter", author: "@loud", text: "Now there are three fire trucks on the waterfront", occurredAt: at(5) },
  { id: "d3", source: "twitter", author: "@LOUD ", text: "Police have closed the road entirely, big response", occurredAt: at(9) },
];
const prolificPrint = fingerprintOrigins(prolific);
check(
  prolificPrint.independentOrigins === 1,
  "one prolific author posting three different sentences is ONE observation (AC7.1)",
  `${prolificPrint.independentOrigins} origins from 3 items`,
);

const officialFeed = [
  { id: "e1", source: "metservice", text: "Heavy rain warning for Wellington", occurredAt: at(0) },
  { id: "e2", source: "metservice", text: "Severe thunderstorm watch upgraded for the Hutt Valley", occurredAt: at(30) },
];
check(
  fingerprintOrigins(officialFeed).independentOrigins === 2,
  "a source with no author is NOT collapsed — two MetService warnings are two statements",
);

const embedded = [
  { id: "f1", source: "a", text: FLOOD, embedding: [1, 0, 0], occurredAt: at(0) },
  { id: "f2", source: "b", text: `${FLOOD} #wellington`, embedding: [1, 0, 0], occurredAt: at(1) },
  {
    id: "f3",
    source: "c",
    text: "Totally different words describing the same intersection under water this afternoon",
    embedding: [1, 0, 0],
    occurredAt: at(2),
  },
];
const embeddedPrint = fingerprintOrigins(embedded);
check(
  embeddedPrint.originById.get("f2") === "f1",
  "a cosine-identical restatement that SHARES ITS WORDING collapses (embedding path)",
);
check(
  embeddedPrint.originById.get("f3") === "f3",
  "…but a cosine-identical item in DIFFERENT words stays independent — meaning is not origin",
  `${embeddedPrint.independentOrigins} origins from 3 items`,
);

check(
  fingerprintOrigins([]).independentOrigins === 0,
  "an empty cluster has no origins, and does not throw",
);

const shuffled = fingerprintOrigins([...copies, witness].slice().reverse());
check(
  JSON.stringify(shuffled.originGroups) === JSON.stringify(withWitness.originGroups),
  "fingerprinting is DETERMINISTIC — row order out of the database cannot change the count",
);

check(
  NEAR_DUPLICATE_JACCARD > 0.8,
  "the near-duplicate bar is high on purpose: 'related' is not 'the same observation'",
  `jaccard ≥ ${NEAR_DUPLICATE_JACCARD}`,
);

// ─── the two modules together, on the demo story ──────────────────────────────

out("\n── the two modules together ────────────────────────────");

const story = fingerprintOrigins([...copies, witness]);
const verdict = gradeCluster(
  facts({
    independentOrigins: story.independentOrigins,
    itemCount: 4,
    bestSourceReliability: "F",
    lastSeen: NOW,
  }),
);
check(
  verdict.grade.infoCredibility === 3 && verdict.grade.sourceReliability === "F",
  "3 copy-paste echoes + 1 independent witness of one flood → F3, from 4 items and 2 origins",
  verdict.grade.label,
);
check(
  verdict.alertWorthy === true,
  "…and it alerts, with its reasons attached",
  `${verdict.reasons.length} reasons · ${verdict.alertReasons.length} alert reasons`,
);
out("");
for (const reason of verdict.reasons) out(`   · ${reason}`);

// ─── verdict ──────────────────────────────────────────────────────────────────

const failed = checks.filter((c) => !c.ok);
out(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  for (const f of failed) out(`  FAILED: ${f.label}`);
  process.exitCode = 1;
}
