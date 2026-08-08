import { createHash } from "node:crypto";
import {
  type HazardType,
  type SignalLocation,
  LocationMethod,
} from "./signal-schema";

/**
 * Deterministic helpers shared by every collector. Kept out of the use cases so
 * all sources classify and locate identically — an analyst comparing a Reddit
 * post against a water fault should be reading the same vocabulary.
 *
 * Everything here is rules-based rather than model-based, deliberately: it needs
 * no API key, runs offline, and — more importantly — is inspectable. When the UI
 * says "located from place name", we can show exactly which word matched.
 */

/** Wellington bbox: [west, south, east, north]. Matches the WCC SDK's constant. */
export const WELLINGTON_BBOX: [number, number, number, number] = [
  174.62, -41.36, 174.94, -41.14,
];

/**
 * Suburb gazetteer. Coordinates are approximate suburb centroids — good enough
 * to cluster signals, NOT good enough to dispatch to, which is why anything
 * located this way is capped at low confidence and labelled in the UI.
 */
const WELLINGTON_PLACES: Record<string, [number, number]> = {
  "aro valley": [174.7627, -41.2953],
  berhampore: [174.7748, -41.3241],
  brooklyn: [174.7625, -41.3061],
  karori: [174.7397, -41.2847],
  kelburn: [174.7666, -41.2896],
  khandallah: [174.7906, -41.2436],
  "island bay": [174.7739, -41.3395],
  johnsonville: [174.8036, -41.2264],
  kilbirnie: [174.7936, -41.3164],
  "lyall bay": [174.7955, -41.3283],
  miramar: [174.8158, -41.3163],
  newtown: [174.7797, -41.3106],
  ngaio: [174.7736, -41.2504],
  "oriental bay": [174.7896, -41.2925],
  petone: [174.8712, -41.2226],
  seatoun: [174.8324, -41.3243],
  strathmore: [174.8207, -41.3287],
  tawa: [174.8262, -41.1697],
  "te aro": [174.7762, -41.2954],
  thorndon: [174.7784, -41.2735],
  wadestown: [174.7676, -41.2678],
  "wellington cbd": [174.7762, -41.2865],
  "wellington central": [174.7762, -41.2865],
  hataitai: [174.7947, -41.3053],
  "mount victoria": [174.7877, -41.2955],
  "mount cook": [174.7735, -41.3012],
  newlands: [174.8175, -41.2137],
  "churton park": [174.8047, -41.1946],
  porirua: [174.8402, -41.1339],
  "lower hutt": [174.9165, -41.2088],
  "upper hutt": [175.0709, -41.1244],
  taita: [174.9556, -41.1793],
  wainuiomata: [174.9498, -41.2624],
  eastbourne: [174.9033, -41.2916],
  makara: [174.7078, -41.2372],
  "owhiro bay": [174.7565, -41.3444],
  "houghton bay": [174.7861, -41.3428],
  roseneath: [174.7994, -41.2896],
  pipitea: [174.7817, -41.276],
  pōneke: [174.7762, -41.2865],
  poneke: [174.7762, -41.2865],
};

/** Longest name first, so "wellington central" wins over "wellington". */
const PLACE_NAMES = Object.keys(WELLINGTON_PLACES).sort(
  (a, b) => b.length - a.length,
);

/**
 * Find a Wellington place mentioned in free text.
 * Returns null rather than guessing — an absent location is honest, a wrong one
 * is worse than useless to an intelligence team.
 */
export function resolvePlaceFromText(text: string): SignalLocation | null {
  const haystack = text.toLowerCase();

  for (const place of PLACE_NAMES) {
    // Word-boundary match so "tawa" doesn't fire inside "tawapuku".
    const pattern = new RegExp(
      `\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    if (!pattern.test(haystack)) continue;

    const [lng, lat] = WELLINGTON_PLACES[place];
    return {
      lng,
      lat,
      // A suburb centroid inferred from prose. Low by construction.
      confidence: 0.4,
      method: LocationMethod.PlaceName,
      matchedPlace: place,
      locationText: place,
    };
  }

  return null;
}

/** True when a point falls inside the Wellington region bbox. */
export function isInWellington(lng: number, lat: number): boolean {
  const [west, south, east, north] = WELLINGTON_BBOX;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

const HAZARD_PATTERNS: Array<[HazardType, RegExp]> = [
  [
    "flooding",
    /\b(flood(ing|ed)?|surface water|inundat|deluge|downpour|storm ?water|ponding)\b/i,
  ],
  [
    "landslide",
    /\b(landslip|land ?slide|slip|slump|debris flow|rockfall|washout)\b/i,
  ],
  ["earthquake", /\b(earthquake|quake|aftershock|shaking|seismic|tremor)\b/i],
  ["fire", /\b(fire|blaze|smoke|burning|scrub fire)\b/i],
  ["wind", /\b(gale|wind(s|y)?|gust|tornado|severe wind)\b/i],
  ["power", /\b(power (cut|out)|outage|blackout|no electricity|lines down)\b/i],
  [
    "water",
    /\b(burst (pipe|main)|water main|no water|blockage|waste ?water|sewage|leak)\b/i,
  ],
  [
    "transport",
    /\b(road closed|closure|crash|detour|traffic|rail|train|ferry|bus)\b/i,
  ],
  [
    "coastal",
    /\b(storm surge|king tide|swell|tsunami|coastal (erosion|inundation))\b/i,
  ],
];

/** Coarse triage only. First match wins; falls back to "other". */
export function classifyHazard(text: string): HazardType {
  for (const [hazard, pattern] of HAZARD_PATTERNS) {
    if (pattern.test(text)) return hazard;
  }
  return "other";
}

/**
 * Stable pseudonym for an author.
 *
 * The scoring service needs a consistent author reference so one prolific
 * poster can't be mistaken for corroboration — but this repo is public and must
 * stay free of personal information, and raw handles are personal data. A salted
 * digest satisfies both: the same author always maps to the same token, and the
 * token doesn't identify anyone.
 *
 * Set SIGNALS_AUTHOR_SALT so tokens aren't reversible via a rainbow table of
 * known handles. Set SIGNALS_SEND_RAW_AUTHOR=true only if the receiving service
 * genuinely requires real handles AND that has been agreed.
 */
export function pseudonymiseAuthor(
  handle: string | null | undefined,
): string | null {
  if (!handle) return null;
  if (process.env.SIGNALS_SEND_RAW_AUTHOR === "true") return handle;

  const salt = process.env.SIGNALS_AUTHOR_SALT ?? "impact-lab-wlg-t4";
  const digest = createHash("sha256")
    .update(`${salt}:${handle.toLowerCase()}`)
    .digest("hex");
  return `anon-${digest.slice(0, 12)}`;
}

/** Extract http(s) links from free text — used to populate quotedUrls. */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g);
  return matches ? Array.from(new Set(matches)) : [];
}
