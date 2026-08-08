import { z } from "zod";
import { DATASET_LIVE } from "@/db/vocabulary";
import { type Group } from "@/repositories/groups/group-schema";
import { type Signal } from "@/repositories/signals/signal-schema";
import { getGroupsUseCase } from "@/use-cases/groups/get-groups-use-case";
import { getGradeEventsUseCase } from "@/use-cases/grade-events/get-grade-events-use-case";
import { getSignalsForGroupsUseCase } from "@/use-cases/signals/get-signals-for-groups-use-case";
import { INCIDENT_LEVEL } from "@/use-cases/vectors/assign-signal-use-case";
import { createUseCase } from "@/utilities/create-use-case";
import { haversineMetres } from "@/utilities/geo";
import { ScoredSignalSchema, type ScoredSignal } from "./scored-signal-schema";

/**
 * The map layer: every graded cluster as a GeoJSON Feature, ready to hand
 * straight to MapLibre with no translation and no second call.
 *
 * GeoJSON rather than a bespoke shape because this module is one piece of a
 * SHARED common operating picture — a format three other prototypes already
 * read is worth more than a format that fits us perfectly.
 *
 * Four things this read refuses to do:
 *
 *   - **emit a cluster with no evidence.** A feature with nothing behind it is
 *     the exact failure mode this system exists to prevent (AC33.2), so a
 *     cluster whose items are all filtered out by `asAt` is simply not there.
 *   - **guess a location.** A cluster no item could place is EXCLUDED from the
 *     map and still returned by `signals.detail` (AC12.3). Drawing it at 0,0 or
 *     at the city centre would invent geography.
 *   - **cross datasets.** `datasetId` defaults to "live", so a fixture set can
 *     never appear on the operational map by accident (AC4.2).
 *   - **publish a score.** No blended number, ever (Decision 3).
 */

/** More clusters than a four-minute demo — or an operator — can look at. */
export const GEOJSON_LIMIT = 500;

/** Year 2100: past any feed's clock skew, inside every timestamp encoder. */
const FAR_FUTURE = new Date("2100-01-01T00:00:00.000Z");

export const BboxSchema = z.object({
  minLng: z.number().min(-180).max(180),
  minLat: z.number().min(-90).max(90),
  maxLng: z.number().min(-180).max(180),
  maxLat: z.number().min(-90).max(90),
});

export const FeatureSchema = z.object({
  type: z.literal("Feature"),
  /** WGS84 Point, `[lng, lat]` — GeoJSON's order, not ours. */
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: ScoredSignalSchema.extend({
    /**
     * Metres of uncertainty around the point when the location was INFERRED
     * (averaged across items) rather than stated. Null when stated: an exact
     * coordinate needs no halo, and drawing one would overstate our doubt.
     */
    radiusM: z.number().nullable(),
  }),
});

export const FeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(FeatureSchema),
  /**
   * Not part of the GeoJSON spec, and deliberately present: a map that silently
   * drops the clusters it cannot place is a map that reads as "nothing is
   * happening there". Renderers ignore unknown members; humans should not.
   */
  unmappable: z.array(z.object({ signalId: z.uuid(), itemCount: z.number().int() })),
});

export type FeatureCollection = z.infer<typeof FeatureCollectionSchema>;

export const getSignalsGeojsonUseCase = createUseCase(
  {
    id: "get-signals-geojson",
    inputSchema: z.object({
      datasetId: z.string().min(1).optional(),
      /** Only evidence we had CAPTURED by this instant. Filters on ingested_at. */
      asAt: z.date().optional(),
      bbox: BboxSchema.optional(),
      /**
       * Admiralty credibility, where 1 is best and 6 is "cannot be judged".
       * A feature is kept when it is AT LEAST this credible, i.e. when
       * `infoCredibility <= minCredibility`. Ungraded clusters never survive it.
       */
      minCredibility: z.number().int().min(1).max(6).optional(),
      limit: z.number().int().positive().max(GEOJSON_LIMIT).optional(),
    }),
    outputSchema: FeatureCollectionSchema,
  },
  async ({ success, error }, { datasetId, asAt, bbox, minCredibility, limit, log }) => {
    const dataset = datasetId ?? DATASET_LIVE;

    const groups = await getGroupsUseCase({
      level: INCIDENT_LEVEL,
      // The whole picture: `asAt` is this surface's time control, and a second,
      // different time filter would only fight it. `to` is the far end of any
      // clock a feed could plausibly claim, not JavaScript's maximum date —
      // that one serialises to a year Postgres will not read back.
      from: new Date(0),
      to: FAR_FUTURE,
      datasetId: dataset,
      limit: limit ?? GEOJSON_LIMIT,
      log,
    });
    if (groups.error) return error(groups.error);
    if (groups.data.length === 0) {
      return success({ type: "FeatureCollection", features: [], unmappable: [] });
    }

    const members = await getSignalsForGroupsUseCase({
      groupIds: groups.data.map((g) => g.id),
      asAt,
      log,
    });
    if (members.error) return error(members.error);

    const itemsByGroup = new Map<string, Signal[]>();
    for (const row of members.data) {
      const existing = itemsByGroup.get(row.groupId);
      if (existing) existing.push(row.signal);
      else itemsByGroup.set(row.groupId, [row.signal]);
    }

    // With `asAt` the CURRENT grade is the wrong answer — it was computed from
    // evidence that had not arrived yet. The grade as at an instant is the last
    // transition at or before it (AC24.2). Walking the history oldest-first and
    // overwriting leaves exactly that in the map.
    const gradeAsAt = new Map<
      string,
      { grade: ScoredSignal["grade"]; reasons: string[]; independentSources: number }
    >();

    if (asAt) {
      const history = await getGradeEventsUseCase({
        groupIds: groups.data.map((g) => g.id),
        asAt,
        order: "asc",
        log,
      });
      if (history.error) return error(history.error);

      for (const event of history.data) {
        gradeAsAt.set(event.groupId, {
          grade: event.toGrade,
          reasons: event.reasons,
          independentSources: event.independentSources,
        });
      }
    }

    const features: z.infer<typeof FeatureSchema>[] = [];
    const unmappable: { signalId: string; itemCount: number }[] = [];

    for (const group of groups.data) {
      const items = itemsByGroup.get(group.id) ?? [];

      // AC33.2: no evidence, no feature. Not an empty shell — simply absent.
      if (items.length === 0) continue;

      const scored = toScoredSignal({ group, items, asAtGrade: asAt ? gradeAsAt.get(group.id) : undefined });

      if (minCredibility !== undefined) {
        // An ungraded cluster cannot clear a credibility floor; it has not made
        // a claim yet. Better absent than admitted on a technicality.
        if (scored.grade === null || scored.grade.infoCredibility > minCredibility) continue;
      }

      const placed = locate(items);
      if (placed === null) {
        unmappable.push({ signalId: group.id, itemCount: items.length });
        continue;
      }

      if (bbox && !inBbox(placed, bbox)) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [placed.lng, placed.lat] },
        properties: { ...scored, radiusM: placed.radiusM },
      });
    }

    log?.info(
      {
        datasetId: dataset,
        features: features.length,
        unmappable: unmappable.length,
        asAt: asAt?.toISOString() ?? null,
        bbox: bbox ? true : false,
        minCredibility: minCredibility ?? null,
      },
      "Published the GeoJSON map layer",
    );

    return success({ type: "FeatureCollection", features, unmappable });
  },
);

// ─── internals ────────────────────────────────────────────────────────────────

/**
 * The one place a stored cluster becomes the published scored-signal shape.
 *
 * `independentSources` is a PLACEHOLDER of 1 until origin fingerprinting lands
 * (convergence's module seam), and the grading module's reasons say so on every
 * response. It is deliberately not `itemCount` and deliberately not
 * `distinctSources`: an over-count here is the most dangerous possible error,
 * because "four independent sources" is precisely what makes a duty officer act.
 */
export function toScoredSignal(input: {
  group: Group;
  items: Signal[];
  /** The grade as at an instant, when a time control asked for one. */
  asAtGrade?: { grade: ScoredSignal["grade"]; reasons: string[]; independentSources: number };
}): ScoredSignal {
  const { group, items } = input;
  const located = items.filter((i) => i.lat !== null && i.lng !== null);

  return {
    signalId: group.id,
    datasetId: group.datasetId,
    grade: input.asAtGrade ? input.asAtGrade.grade : group.grade,
    reasons: input.asAtGrade ? input.asAtGrade.reasons : (group.reasons ?? []),
    independentSources: input.asAtGrade ? input.asAtGrade.independentSources : 1,
    itemCount: items.length,
    alertWorthy: group.alertWorthy,
    syntheticContributor: items.some((i) => i.synthetic),
    label: group.label,
    locationCertainty: located.length === 0 ? "unknown" : located.length === 1 ? "stated" : "inferred",
    sourceClasses: [...new Set(items.map((i) => i.sourceClass))].sort(),
    firstSeen: new Date(Math.min(...items.map((i) => i.occurredAt.getTime()))),
    lastSeen: new Date(Math.max(...items.map((i) => i.occurredAt.getTime()))),
    confirmedBy: group.confirmedBy,
  };
}

/**
 * Where to draw it, recomputed from the items that survived `asAt` rather than
 * read off the cached centroid — a time-scrubbed map must not show a position
 * that later evidence moved.
 *
 * `radiusM` is the furthest contributing item from that mean: an honest halo
 * around an averaged position, and null when there is only one coordinate to
 * average, because that point is exactly where somebody said it was.
 */
function locate(items: Signal[]): { lat: number; lng: number; radiusM: number | null } | null {
  const located = items.filter(
    (i): i is Signal & { lat: number; lng: number } => i.lat !== null && i.lng !== null,
  );
  if (located.length === 0) return null;

  const lat = located.reduce((sum, i) => sum + i.lat, 0) / located.length;
  const lng = located.reduce((sum, i) => sum + i.lng, 0) / located.length;
  if (located.length === 1) return { lat, lng, radiusM: null };

  const radiusM = Math.round(
    Math.max(...located.map((i) => haversineMetres({ lat, lng }, { lat: i.lat, lng: i.lng }))),
  );
  return { lat, lng, radiusM };
}

function inBbox(
  point: { lat: number; lng: number },
  bbox: z.infer<typeof BboxSchema>,
): boolean {
  return (
    point.lng >= bbox.minLng &&
    point.lng <= bbox.maxLng &&
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat
  );
}
