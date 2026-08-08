"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useRef, useState } from "react";
import { FeatureError } from "@/components/errors/feature-error";
import { MapLegend } from "@/features/hazard-map/components/map-legend";
import { MAP_LAYER_IDS } from "@/features/hazard-map/map-layers";
import { useTRPC } from "@/trpc/client";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";
import { BoardMapSkeleton } from "./board-map-skeleton";
import { BoardScrubber } from "./board-scrubber";
import { MapCanvas } from "./components/map-canvas";
import { UnmappableGutter } from "./components/unmappable-gutter";

/** The picture should feel live in a four-minute demo without hammering the API. */
const POLL_MS = 3000;

/** Ray-casting point-in-polygon over GeoJSON rings (outer ring + holes). */
function pointInRings(lng: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * The map mode's only hook caller: Council hazard geography and our signal
 * clusters, fetched separately and drawn on one canvas.
 *
 * The two reads are deliberately NOT gated on each other. Hazard layers come
 * from three different Council ArcGIS servers and can take seconds or fail
 * outright; signals come from our own database in milliseconds. Waiting for the
 * slowest of them before drawing anything would mean an operator stares at a
 * skeleton while we already know where the flooding is being reported.
 */
export function BoardMapClient({
  datasetId,
  selectedSignalId,
  onSelect,
  asAt,
  onAsAtChange,
}: {
  datasetId: string;
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
  /**
   * Time travel: null = live (polling); a number = the board as it stood then.
   * asAt reconstructs counts and grades from what had been CAPTURED by that
   * instant, so dragging left literally unwinds what we knew. Owned by the
   * shell — the ticker and the drill panel replay from the same clock.
   */
  asAt: number | null;
  onAsAtChange: (asAt: number | null) => void;
}) {
  const trpc = useTRPC();
  const { resolvedTheme } = useTheme();

  const signals = useQuery(
    trpc.signals.geojson.queryOptions(
      asAt === null ? { datasetId } : { datasetId, asAt: new Date(asAt) },
      {
        refetchInterval: asAt === null ? POLL_MS : false,
        // Scrubbing changes the query key on every step; without this the map
        // flashes empty between instants. Keep the last picture until the next
        // one arrives — dots then MOVE rather than blink.
        placeholderData: keepPreviousData,
      },
    ),
  );

  // One query per layer, driven off a fixed list so the hook count is stable.
  // These are static Council datasets — no refetchInterval, unlike the signals.
  const layerResults = useQueries({
    queries: MAP_LAYER_IDS.map((id) => trpc.gis.layer.queryOptions({ datasetId: id })),
  });

  // Suburb polygons feed the derived impact-zones layer, not the hazard list.
  const suburbs = useQuery(
    trpc.gis.layer.queryOptions({ datasetId: "suburb-boundaries" }, { staleTime: Infinity }),
  );

  // Impact zones: Council communicates in suburb names, so affected areas ARE
  // suburbs — report mass aggregated by point-in-polygon, shaded in place. The
  // suburbs are the display itself, not an underlay: Jacob's call, after the
  // dots-over-polygons version read as clutter.
  const impactZones = useMemo<MapLayer | null>(() => {
    const polys = suburbs.data?.featureCollection.features;
    const pts = signals.data?.features;
    if (!polys || !pts || pts.length === 0) return null;

    type Zone = {
      poly: (typeof polys)[number];
      suburb: string;
      polygons: number[][][][];
      mass: number;
      signalIds: string[];
      top: { id: string; count: number } | null;
    };
    const zonesBySuburb = new Map<string, Zone>();
    const allZones: Zone[] = [];
    for (const poly of polys) {
      const geom = poly.geometry as {
        type: string;
        coordinates: number[][][] | number[][][][];
      } | null;
      if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
      const zone: Zone = {
        poly,
        suburb: (poly.properties as { suburb?: string } | null)?.suburb ?? "",
        polygons: (geom.type === "Polygon"
          ? [geom.coordinates]
          : geom.coordinates) as number[][][][],
        mass: 0,
        signalIds: [],
        top: null,
      };
      allZones.push(zone);
      if (zone.suburb) zonesBySuburb.set(zone.suburb.toLowerCase(), zone);
    }

    for (const f of pts) {
      const props = f.properties as {
        signalId: string;
        itemCount?: number;
        label?: string | null;
      };

      // The label carries the locality the evidence VOTED for ("flooding —
      // Aro Valley", "… — Clyde Street, Island Bay, Wellington"), so trust a
      // named suburb before the averaged position: a big cluster's centroid
      // can drift over a boundary ridge into the neighbouring suburb, and the
      // 700-item Aro Valley story must not paint Brooklyn red.
      let target: Zone | undefined;
      const [, afterHazard] = (props.label ?? "").split(/\s+—\s+/);
      for (const segment of (afterHazard ?? props.label ?? "").split(",")) {
        target = zonesBySuburb.get(segment.trim().toLowerCase());
        if (target) break;
      }
      if (!target) {
        const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
        target = allZones.find((zone) =>
          zone.polygons.some((rings) => pointInRings(lng, lat, rings)),
        );
      }
      if (!target) continue;

      const count = props.itemCount ?? 1;
      target.mass += count;
      target.signalIds.push(props.signalId);
      if (!target.top || count > target.top.count) target.top = { id: props.signalId, count };
    }

    const scored = allZones.filter((zone) => zone.mass > 0 && zone.top !== null);
    if (scored.length === 0) return null;

    // Hybrid bands for a heavy-tailed distribution: HOT is relative — the
    // suburb(s) carrying the dominant share of the moment's reports — while
    // warm and mild are absolute, because at the low end "five reports" has a
    // stable meaning that a percentage of a 700-item story does not.
    //
    // Suburbs with a single stray report are not shaded at all. Shading every
    // suburb that had one report painted the whole city and lifted nothing —
    // the map's job is to say where attention goes, so quiet suburbs stay
    // paper. (Their reports remain in the feed and the drill panel.)
    const busiest = Math.max(...scored.map((zone) => zone.mass));
    const zones = scored
      .filter(({ mass }) => mass >= 2)
      .map(({ poly, suburb, mass, signalIds, top }) => ({
        ...poly,
        properties: {
          suburb,
          mass,
          signalIds,
          topSignalId: top ? top.id : signalIds[0],
          band: mass >= Math.max(8, busiest * 0.4) ? "hot" : mass >= 5 ? "warm" : "mild",
        },
      }));
    if (zones.length === 0) return null;
    return {
      datasetId: "impact-zones",
      displayName: "Impact zones",
      authority: "Derived — report counts by WCC suburb",
      attribution: "Suburb boundaries © Wellington City Council",
      geometryKind: "polygon",
      caveat:
        "Shading aggregates report counts by suburb; suburbs with only scattered reports are left unshaded so the busy ones stand out. Unshaded is absence of information, not absence of impact.",
      fetchedAt: suburbs.data!.fetchedAt,
      truncated: suburbs.data!.truncated,
      featureCollection: { type: "FeatureCollection", features: zones },
    };
  }, [suburbs.data, signals.data]);

  const layers = useMemo(() => {
    const hazard = layerResults
      .map((r) => r.data)
      .filter((layer): layer is MapLayer => layer !== undefined);
    return impactZones ? [impactZones, ...hazard] : hazard;
  }, [layerResults, impactZones]);

  // Council layers arrive one at a time and the legend says how many are still
  // coming, so an operator can tell "no ponding here" from "ponding not loaded".
  const pendingCount = layerResults.filter((result) => result.isLoading).length;

  const failedDatasetIds = useMemo(
    () => MAP_LAYER_IDS.filter((_, index) => layerResults[index].isError),
    [layerResults],
  );

  // Held here rather than in the legend because the canvas needs it too, and
  // stored as the hidden set so the default — everything visible — is empty.
  const [hiddenDatasetIds, setHiddenDatasetIds] = useState<ReadonlySet<string>>(new Set());
  const toggleDataset = useCallback((id: string) => {
    setHiddenDatasetIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // The slider's left edge: the earliest CAPTURE ever seen this session — the
  // clock asAt actually filters on. firstSeen runs on the event's own clock
  // and can predate collection by days, which would park most of the track
  // before anything had arrived. A ref rather than a memo of the current
  // response — scrubbing SHRINKS the response, and the time domain must not
  // shrink with it.
  const domainStartRef = useRef<number | null>(null);
  const earliest = signals.data?.captureStart
    ? new Date(signals.data.captureStart).getTime()
    : Infinity;
  if (Number.isFinite(earliest)) {
    domainStartRef.current = Math.min(domainStartRef.current ?? earliest, earliest);
  }

  if (signals.isError) return <FeatureError name="the map" />;
  if (!signals.data) return <BoardMapSkeleton />;

  const { features, unmappable } = signals.data;

  return (
    <div className="absolute inset-0">
      <MapCanvas
        layers={layers}
        hiddenDatasetIds={hiddenDatasetIds}
        // Follows the app theme: dark tiles under a light interface is the one
        // combination that reads as broken rather than as a choice.
        basemap={resolvedTheme === "dark" ? "dark" : "light"}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />

      {(layers.length > 0 || pendingCount > 0) && (
        <MapLegend
          layers={layers}
          hiddenDatasetIds={hiddenDatasetIds}
          onToggleDataset={toggleDataset}
          failedDatasetIds={failedDatasetIds}
          pendingCount={pendingCount}
        />
      )}

      {/* The credibility colour key left with the dots — zone colour means
          report volume, and the map legend explains that. Credibility words
          live in the drill panel, next to the evidence they grade. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-end gap-3 p-3 pb-8">
        <UnmappableGutter entries={unmappable} onSelect={onSelect} />
      </div>

      <p
        aria-live="polite"
        className="text-muted-foreground/80 absolute top-3 right-14 z-10 font-mono text-[10px]"
      >
        {features.length} placed
        {signals.isFetching ? " · refreshing" : ""}
        {asAt !== null ? " · as at " : ""}
      </p>

      {domainStartRef.current !== null && (
        <BoardScrubber
          domainStart={domainStartRef.current}
          value={asAt}
          onChange={onAsAtChange}
        />
      )}

      {/* An empty map and a broken map look identical, so say which this is.
          While time-travelling, empty is not broken OR missing — it's history:
          the moment before the first report had been collected. */}
      {features.length === 0 && unmappable.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="bg-card border-border pointer-events-auto max-w-[340px] rounded-lg border p-4 text-center">
            {asAt !== null ? (
              <>
                <p className="text-[12.5px] font-semibold">Nothing had arrived yet</p>
                <p className="text-muted-foreground mt-1.5 text-[11.5px] leading-relaxed">
                  This is the board as it stood before the first report was collected.
                  Press play or drag right to watch the picture build.
                </p>
              </>
            ) : (
              <>
                <p className="text-[12.5px] font-semibold">No signals yet</p>
                <p className="text-muted-foreground mt-1.5 text-[11.5px] leading-relaxed">
                  The feed is empty. As reports are collected they will appear here,
                  grouped and graded.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
