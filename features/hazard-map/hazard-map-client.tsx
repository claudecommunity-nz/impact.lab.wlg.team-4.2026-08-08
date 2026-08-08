"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQueries } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { FeatureError } from "@/components/errors/feature-error";
import { useTRPC } from "@/trpc/client";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";
import { formatRelativeTime } from "@/utilities/format-relative-time";
import { MAP_LAYER_IDS } from "./map-layers";
import { MapLegend } from "./components/map-legend";
import { HazardMapSkeleton } from "./hazard-map-skeleton";

// MapLibre reads `window` on import, so the canvas never renders on the server.
// The layer DATA still server-prefetches and hydrates — only the canvas waits.
const MapCanvas = dynamic(() => import("./components/map-canvas").then((m) => m.MapCanvas), {
  ssr: false,
});

/** The only file in the feature that touches hooks. */
export function HazardMapClient() {
  const trpc = useTRPC();
  const { resolvedTheme } = useTheme();

  // One query per layer, driven off a fixed list so the hook count is stable.
  const results = useQueries({
    queries: MAP_LAYER_IDS.map((datasetId) => trpc.gis.layer.queryOptions({ datasetId })),
  });

  const layers = useMemo(
    () => results.map((r) => r.data).filter((layer): layer is MapLayer => layer !== undefined),
    [results],
  );

  // These five layers come from three different Council servers. One of them
  // being slow or down shouldn't blank the map, so we draw what we have and
  // name what's missing rather than failing the whole feature.
  const failedDatasetIds = useMemo(
    () => MAP_LAYER_IDS.filter((_, i) => results[i].isError),
    [results],
  );

  // Which layers are switched off. Held here rather than in the legend because
  // the canvas needs it too, and stored as the hidden set so the default —
  // everything visible — is the empty one.
  const [hiddenDatasetIds, setHiddenDatasetIds] = useState<ReadonlySet<string>>(new Set());
  const toggleDataset = useCallback((datasetId: string) => {
    setHiddenDatasetIds((current) => {
      const next = new Set(current);
      if (!next.delete(datasetId)) next.add(datasetId);
      return next;
    });
  }, []);

  if (results.some((r) => r.isLoading)) return <HazardMapSkeleton />;
  if (layers.length === 0) return <FeatureError name="the hazard map" />;

  const fetchedAt = layers[0].fetchedAt;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Wellington hazard map</h1>
          <p className="text-muted-foreground text-sm">
            Council hazard layers on a shared map. Click any feature for its published attributes.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          Updated <time dateTime={fetchedAt.toISOString()}>{formatRelativeTime(fetchedAt)}</time>
        </Badge>
      </header>

      <div className="relative h-[36rem] w-full overflow-hidden rounded-lg border">
        <MapLegend
          layers={layers}
          hiddenDatasetIds={hiddenDatasetIds}
          onToggleDataset={toggleDataset}
          failedDatasetIds={failedDatasetIds}
        />
        <MapCanvas
          layers={layers}
          basemap={resolvedTheme === "dark" ? "dark" : "light"}
          hiddenDatasetIds={hiddenDatasetIds}
        />
      </div>

      <footer className="text-muted-foreground space-y-0.5 text-[11px]">
        <p>
          Boundaries are generalised to roughly 10 m for display — read them as approximate
          extents, not surveyed lines. Each layer states its own limitations when you open a
          feature.
        </p>
        {layers.map((layer) => (
          <p key={layer.datasetId}>{layer.attribution}</p>
        ))}
      </footer>
    </div>
  );
}
