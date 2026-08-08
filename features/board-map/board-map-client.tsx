"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useState } from "react";
import { CredibilityLegend } from "@/components/board/grade";
import { FeatureError } from "@/components/errors/feature-error";
import { MapLegend } from "@/features/hazard-map/components/map-legend";
import { MAP_LAYER_IDS } from "@/features/hazard-map/map-layers";
import { useTRPC } from "@/trpc/client";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";
import { BoardMapSkeleton } from "./board-map-skeleton";
import { MapCanvas } from "./components/map-canvas";
import { UnmappableGutter } from "./components/unmappable-gutter";

/** The picture should feel live in a four-minute demo without hammering the API. */
const POLL_MS = 3000;

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
}: {
  datasetId: string;
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const trpc = useTRPC();
  const { resolvedTheme } = useTheme();

  const signals = useQuery(
    trpc.signals.geojson.queryOptions({ datasetId }, { refetchInterval: POLL_MS }),
  );

  // One query per layer, driven off a fixed list so the hook count is stable.
  // These are static Council datasets — no refetchInterval, unlike the signals.
  const layerResults = useQueries({
    queries: MAP_LAYER_IDS.map((id) => trpc.gis.layer.queryOptions({ datasetId: id })),
  });

  const layers = useMemo(
    () => layerResults.map((r) => r.data).filter((layer): layer is MapLayer => layer !== undefined),
    [layerResults],
  );

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

  if (signals.isError) return <FeatureError name="the map" />;
  if (!signals.data) return <BoardMapSkeleton />;

  const { features, unmappable } = signals.data;

  return (
    <div className="absolute inset-0">
      <MapCanvas
        features={features}
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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3 pb-8">
        <div className="bg-card border-border pointer-events-auto ml-24 rounded-lg border p-2.5">
          <CredibilityLegend />
          <p className="text-muted-foreground/80 mt-2 max-w-[190px] font-mono text-[9.5px] leading-relaxed">
            Dashed ring = location inferred; the circle is how far the contributing
            reports spread.
          </p>
        </div>

        <UnmappableGutter entries={unmappable} onSelect={onSelect} />
      </div>

      <p
        aria-live="polite"
        className="text-muted-foreground/80 absolute top-3 right-14 z-10 font-mono text-[10px]"
      >
        {features.length} placed
        {signals.isFetching ? " · refreshing" : ""}
      </p>

      {/* An empty map and a broken map look identical, so say which this is. */}
      {features.length === 0 && unmappable.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="bg-card border-border pointer-events-auto max-w-[340px] rounded-lg border p-4 text-center">
            <p className="text-[12.5px] font-semibold">
              No signals in the “{datasetId}” dataset
            </p>
            <p className="text-muted-foreground mt-1.5 text-[11.5px] leading-relaxed">
              Clustering never crosses datasets, so this board is showing exactly one
              namespace. The synthetic demo story lives in{" "}
              <span className="font-mono">demo</span> — load it with{" "}
              <span className="font-mono">npm run demo:plumb</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
