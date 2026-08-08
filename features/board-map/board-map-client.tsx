"use client";

import { useQuery } from "@tanstack/react-query";
import { CredibilityLegend } from "@/components/board/grade";
import { FeatureError } from "@/components/errors/feature-error";
import { useTRPC } from "@/trpc/client";
import { BoardMapSkeleton } from "./board-map-skeleton";
import { MapCanvas } from "./components/map-canvas";
import { UnmappableGutter } from "./components/unmappable-gutter";

/** The picture should feel live in a four-minute demo without hammering the API. */
const POLL_MS = 3000;

/**
 * The map pane's only hook caller. Reads `signals.geojson` straight off the tRPC
 * proxy — the shell prefetched it, so the first paint is real data and these
 * loading branches only ever show on a client-side refetch.
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
  const signals = useQuery(
    trpc.signals.geojson.queryOptions({ datasetId }, { refetchInterval: POLL_MS }),
  );

  if (signals.isError) return <FeatureError name="the map" />;
  if (!signals.data) return <BoardMapSkeleton />;

  const { features, unmappable } = signals.data;

  return (
    <div className="absolute inset-0">
      <MapCanvas
        features={features}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
        <div className="board-panel pointer-events-auto rounded-lg border p-2.5">
          <CredibilityLegend />
          <p className="board-faint mt-2 max-w-[190px] font-mono text-[9.5px] leading-relaxed">
            Dashed ring = location inferred; the circle is how far the contributing
            reports spread.
          </p>
        </div>

        <UnmappableGutter entries={unmappable} onSelect={onSelect} />
      </div>

      <p
        aria-live="polite"
        className="board-faint absolute top-3 right-14 z-10 font-mono text-[10px]"
      >
        {features.length} placed
        {signals.isFetching ? " · refreshing" : ""}
      </p>

      {/* An empty map and a broken map look identical, so say which this is. */}
      {features.length === 0 && unmappable.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="board-panel pointer-events-auto max-w-[340px] rounded-lg border p-4 text-center">
            <p className="text-[12.5px] font-semibold">
              No signals in the “{datasetId}” dataset
            </p>
            <p className="board-muted mt-1.5 text-[11.5px] leading-relaxed">
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
