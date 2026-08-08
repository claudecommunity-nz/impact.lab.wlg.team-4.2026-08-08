/**
 * What KIND of problem a cluster is describing, and how fast that kind of
 * report goes stale. Pure — no IO, no db, no clock, no zod.
 *
 * Two jobs, one file, because they are the same fact seen twice: the half-life
 * table is meaningless without the classification, and the classification earns
 * its keep by choosing the half-life.
 *
 * Deliberately a KEYWORD table rather than a model call. Three reasons, in
 * order of how much they matter here:
 *
 *   1. it must be pure. Freshness is threaded off `now`, and a replay of a
 *      historical fixture has to produce identical grades on any day, from any
 *      machine, with no network;
 *   2. an operator can read it. "We called this flooding because the report
 *      says 'water over the road'" is auditable in a way that "the model said
 *      so" is not, and this whole module exists to be auditable;
 *   3. it is never load-bearing for truth. The classification picks a decay
 *      rate and labels an alert. It never decides whether something happened.
 *
 * A model-derived issue type belongs in `annotations` alongside this, not
 * instead of it — that is exactly the shape the annotation vocabulary is for.
 */

/**
 * Suggested values, in the sense the rest of this codebase means it: an issue
 * type outside this list must never be a failure. `other` is the honest landing
 * place for a report about something nobody anticipated, which in an emergency
 * is a category that fills up fast.
 */
export const ISSUE_TYPES = [
  "flooding",
  "fire",
  "slip",
  "wind",
  "tree_down",
  "road_closure",
  "power_outage",
  "water_supply",
  "structural_damage",
  "injury",
  "other",
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

/** What we call a cluster nothing in the table matched. */
export const DEFAULT_ISSUE_TYPE: IssueType = "other";

/**
 * How long before a report of this kind is half as current as when it landed.
 *
 * These are decay rates for ATTENTION, not for truth — a flood report from six
 * hours ago is not false, it is simply no longer a description of the present,
 * because the water has either risen or drained and nobody has said which.
 * Structural damage is the opposite: a building that was unsafe this morning is
 * still unsafe tonight, so a 48-hour half-life against flooding's 3 is the
 * spread the PRD asks for (AC23.3) and also just how these things behave.
 */
export const ISSUE_HALF_LIFE_HOURS: Record<IssueType, number> = {
  flooding: 3,
  fire: 4,
  wind: 4,
  road_closure: 6,
  power_outage: 6,
  injury: 6,
  water_supply: 8,
  slip: 12,
  tree_down: 12,
  structural_damage: 48,
  other: 12,
};

/**
 * The evidence for each call, in words the classifier can point at afterwards.
 * Ordered by how specific the phrase is, not alphabetically: `slip` is checked
 * for "slip" and "landslide", and a post saying "slip has closed the road" is
 * a slip that caused a closure rather than a closure, so the more specific
 * cause wins on equal counts through the order of ISSUE_TYPES below.
 */
const KEYWORDS: Record<IssueType, readonly string[]> = {
  flooding: [
    "flood",
    "flooding",
    "flooded",
    "surface water",
    // Substrings rather than whole phrases on purpose: the first report of a
    // flood almost never uses the word. "Water is over the road", "water up
    // past the kerb" — a table that only matched "flooding" would classify the
    // earliest and most valuable reports as `other` and decay them at the
    // wrong rate, which is exactly the hour this system exists to serve.
    "water over",
    "water is over",
    "water up",
    "water across",
    "water right across",
    "water is pouring",
    "water pouring",
    "under water",
    "underwater",
    "submerged",
    // Not "swell": a sea state is not water on land, and letting it count
    // outvoted a 128 km/h gust in the storm cluster it was reported from.
    "storm surge",
    "awash",
    "inundat",
    "storm water",
    "stormwater",
    "river level",
    "stream at",
    // Deliberately NOT here: "rainfall", "heavy rain", "rain warning", "gauge".
    // Rain is a PRECURSOR, not an impact — a weather station reporting 34mm has
    // not told us anything is under water, and letting a rainfall total outvote
    // a 128 km/h gust mislabels the storm that is actually happening.
    "waves",
    "driftwood",
    "breach",
    "burst bank",
    "drains not coping",
    "overflow",
  ],
  fire: ["fire", "smoke", "burning", "alight", "ablaze", "fenz"],
  slip: ["slip", "landslide", "landslip", "slumped", "debris flow", "rockfall", "bank collapse"],
  // Wellington's signature hazard, and the one most likely to be reported by
  // its consequences rather than its name — nobody posts "high wind", they post
  // that a sheet of roofing is in the street.
  wind: [
    "gale",
    "gust",
    "wind damage",
    "severe wind",
    "high wind",
    "blown",
    "blew",
    "storm force",
    "roofing metal",
    "roof iron",
    "sheeting",
    "torn loose",
  ],
  tree_down: ["tree down", "trees down", "tree across", "tree on the", "branches everywhere", "large tree"],
  road_closure: [
    "road closed",
    "closure",
    "closed to traffic",
    "blocked",
    "detour",
    "cordon",
    "impassable",
    "gridlock",
    "backed up",
    "one lane",
  ],
  power_outage: [
    "power out",
    "power is out",
    "power cut",
    "off supply",
    "outage",
    "no power",
    "blackout",
    "lines down",
    "wellington electricity",
  ],
  water_supply: ["water main", "no water", "burst main", "boil water", "water supply", "wellington water"],
  structural_damage: [
    "collapse",
    "cracked",
    "structural",
    "roof off",
    "roof came off",
    "roof has come off",
    "building damage",
    "unsafe building",
    "red stickered",
    "facade",
    "wall down",
  ],
  injury: ["injured", "injury", "trapped", "casualt", "ambulance", "hurt", "rescue"],
  other: [],
};

/**
 * Classify a cluster from the words its items actually used.
 *
 * Counts matching phrases across ALL the texts rather than deciding on the
 * first item, because a cluster is the unit being graded and the earliest post
 * about a flood is quite often the least explicit one ("something's happening
 * on Adelaide Rd"). Ties break by ISSUE_TYPES order, so the result is
 * deterministic for a given set of texts in any order — which is what lets a
 * replay reproduce a grade exactly.
 */
export function classifyIssueType(texts: readonly string[]): IssueType {
  const haystack = texts.join(" \n ").toLowerCase();
  if (haystack.trim().length === 0) return DEFAULT_ISSUE_TYPE;

  let best: IssueType = DEFAULT_ISSUE_TYPE;
  let bestHits = 0;

  for (const issueType of ISSUE_TYPES) {
    let hits = 0;
    for (const keyword of KEYWORDS[issueType]) {
      if (haystack.includes(keyword)) hits += 1;
    }
    // Strictly greater: earlier entries in ISSUE_TYPES win ties, which is what
    // makes "slip has closed the road" a slip rather than a road closure.
    if (hits > bestHits) {
      best = issueType;
      bestHits = hits;
    }
  }

  return best;
}

/** The half-life for a type, defaulting rather than throwing on an unknown one. */
export function halfLifeHours(issueType: IssueType): number {
  return ISSUE_HALF_LIFE_HOURS[issueType] ?? ISSUE_HALF_LIFE_HOURS[DEFAULT_ISSUE_TYPE];
}
