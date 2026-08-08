"use client";

import { useQuery } from "@tanstack/react-query";
import { FeatureError } from "@/components/errors/feature-error";
import { BOARD_DATASET } from "@/features/board-shell/board-dataset";
import { useTRPC } from "@/trpc/client";
import { BoardGalaxySkeleton } from "./board-galaxy-skeleton";
import { BubbleField } from "./components/bubble-field";

const POLL_MS = 3000;

/**
 * The trends mode's only hook caller.
 *
 * It reads `vectors.groups` and nothing else now. The three.js point cloud that
 * used to live here also needed `vectors.points`; the bubble field works from
 * the cluster rows alone, which is one fewer query per poll and one fewer way
 * for the mode to be half-loaded.
 */
export function BoardGalaxyClient({
  active,
  selectedSignalId,
  onSelect,
}: {
  /** False while the map is showing — this mode stays mounted but idle. */
  active: boolean;
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const trpc = useTRPC();
  const groups = useQuery(
    trpc.vectors.groups.queryOptions(
      { datasetId: BOARD_DATASET },
      { refetchInterval: active ? POLL_MS : false },
    ),
  );

  if (groups.isError) return <FeatureError name="the trends view" />;
  if (!groups.data) return <BoardGalaxySkeleton />;

  return (
    <div className="absolute inset-0 flex flex-col p-4">
      <p className="text-muted-foreground shrink-0 text-[12px]">
        Every cluster by how much has been reported and how fast it is still arriving.
        Top-right is where to look first.
      </p>
      <div className="min-h-0 flex-1">
        <BubbleField
          groups={groups.data}
          selectedSignalId={selectedSignalId}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}
