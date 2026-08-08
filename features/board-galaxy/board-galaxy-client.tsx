"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { FeatureError } from "@/components/errors/feature-error";
import { useTRPC } from "@/trpc/client";
import { BoardGalaxySkeleton } from "./board-galaxy-skeleton";
import { ClusterList } from "./components/cluster-list";
import { GalaxyScene } from "./components/galaxy-scene";

const POLL_MS = 3000;

/**
 * The galaxy pane's only hook caller: every signal as a point, every cluster as
 * a bubble over it. Two queries rather than one because they are two reads with
 * two limits — and tRPC's httpBatchLink folds them into a single request per
 * poll anyway.
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
  // Mounted-but-hidden must not cost anything: polling stops and the WebGL
  // render loop stops, while the scene and the operator's orbit survive.
  const poll = active ? POLL_MS : false;
  const points = useQuery(trpc.vectors.points.queryOptions({}, { refetchInterval: poll }));
  const groups = useQuery(trpc.vectors.groups.queryOptions({}, { refetchInterval: poll }));

  // `vectors.points` and `vectors.groups` are not namespaced — they return every
  // dataset at once, so on their own this mode would show the map's demo story
  // mixed with whatever fixtures a verify run left in `live`.
  //
  // `signals.geojson` IS namespaced, and its ids ARE cluster ids, so it doubles
  // as the membership list for this dataset. Same query key as the map's, so it
  // is already in cache and costs no extra request.
  //
  // One consequence, and it is the right one: a cluster whose items have all
  // been filtered out appears in neither `features` nor `unmappable`, so it is
  // absent from the galaxy too. The map already refuses to draw a cluster with
  // no evidence behind it, and the two modes must not disagree about what
  // exists.
  const scoped = useQuery(trpc.signals.geojson.queryOptions({ datasetId }, { refetchInterval: poll }));

  const inDataset = useMemo(() => {
    if (!scoped.data) return null;
    return new Set([
      ...scoped.data.features.map((feature) => feature.properties.signalId),
      ...scoped.data.unmappable.map((entry) => entry.signalId),
    ]);
  }, [scoped.data]);

  const visibleGroups = useMemo(
    () => (inDataset ? (groups.data ?? []).filter((group) => inDataset.has(group.id)) : []),
    [groups.data, inDataset],
  );

  // A point with no cluster cannot be attributed to a dataset, so it is left out
  // rather than guessed into this one.
  const visiblePoints = useMemo(
    () =>
      inDataset
        ? (points.data ?? []).filter((point) => point.groupId !== null && inDataset.has(point.groupId))
        : [],
    [points.data, inDataset],
  );

  if (points.isError || groups.isError || scoped.isError) return <FeatureError name="the galaxy" />;
  if (!points.data || !groups.data || !scoped.data) return <BoardGalaxySkeleton />;

  const unprojected = visiblePoints.filter((point) => point.x === null).length;

  return (
    <div className="absolute inset-0">
      <GalaxyScene
        points={visiblePoints}
        groups={visibleGroups}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />

      <p className="board-faint pointer-events-none absolute top-3 right-4 z-10 text-right font-mono text-[10px] leading-relaxed">
        Position = what was said, not where.
        <br />
        {visiblePoints.length - unprojected} of {visiblePoints.length} points projected
        {unprojected > 0 && (
          <>
            <br />
            {unprojected} awaiting projection — not drawn
          </>
        )}
      </p>

      <ClusterList
        groups={visibleGroups}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />
    </div>
  );
}
