"use client";

import { useQuery } from "@tanstack/react-query";
import { FeatureError } from "@/components/errors/feature-error";
import { useTRPC } from "@/trpc/client";
import { BoardGalaxySkeleton } from "./board-galaxy-skeleton";
import { ClusterList } from "./components/cluster-list";
import { GalaxyScene } from "./components/galaxy-scene";

const POLL_MS = 3000;

/**
 * The galaxy mode's only hook caller: every signal as a point, every cluster as
 * a bubble over it. Two queries rather than one because they are two reads with
 * two limits — and tRPC's httpBatchLink folds them into a single request per
 * poll anyway.
 *
 * Both are scoped to the board's dataset. Clustering never crosses datasets, so
 * a galaxy showing every namespace at once would put the demo story, the verify
 * fixtures and the live picture in one cloud and imply they are one event.
 */
export function BoardGalaxyClient({
  active,
  datasetId,
  selectedSignalId,
  onSelect,
}: {
  /** False while the map mode is showing — this mode stays mounted but idle. */
  active: boolean;
  datasetId: string;
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const trpc = useTRPC();
  // Mounted-but-hidden must not cost anything: polling stops while the map is
  // showing, and the scene and the operator's orbit survive.
  const poll = active ? POLL_MS : false;

  const points = useQuery(
    trpc.vectors.points.queryOptions({ datasetId }, { refetchInterval: poll }),
  );
  const groups = useQuery(
    trpc.vectors.groups.queryOptions({ datasetId }, { refetchInterval: poll }),
  );

  if (points.isError || groups.isError) return <FeatureError name="the galaxy" />;
  if (!points.data || !groups.data) return <BoardGalaxySkeleton />;

  const unprojected = points.data.filter((point) => point.x === null).length;

  return (
    <div className="absolute inset-0">
      <GalaxyScene
        points={points.data}
        groups={groups.data}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />

      <p className="text-muted-foreground/80 pointer-events-none absolute top-3 right-4 z-10 text-right font-mono text-[10px] leading-relaxed">
        Position = what was said, not where.
        <br />
        {points.data.length - unprojected} of {points.data.length} points projected
        {unprojected > 0 && (
          <>
            <br />
            {unprojected} awaiting projection — not drawn
          </>
        )}
      </p>

      <ClusterList
        groups={groups.data}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />
    </div>
  );
}
