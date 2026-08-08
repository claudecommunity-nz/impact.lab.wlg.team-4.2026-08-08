"use client";

import { useQuery } from "@tanstack/react-query";
import { FeatureError } from "@/components/errors/feature-error";
import { BOARD_DATASET } from "@/features/board-shell/board-dataset";
import { useTRPC } from "@/trpc/client";
import { BoardGalaxySkeleton } from "./board-galaxy-skeleton";
import { CorroborationBoard } from "./components/corroboration-board";

const POLL_MS = 3000;

/**
 * The trends mode's only hook caller.
 *
 * It reads the SAME published surface the map reads — already framed to
 * Wellington City by the server, already graded, already deduplicated — plus
 * the vector layer's arrival rates, and hands both to the triage queue. Both
 * queries share their keys with the map and the ticker, so this mode costs no
 * extra request per poll.
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
  const poll = active ? POLL_MS : false;

  const signals = useQuery(
    trpc.signals.geojson.queryOptions({ datasetId: BOARD_DATASET }, { refetchInterval: poll }),
  );
  const groups = useQuery(
    trpc.vectors.groups.queryOptions({ datasetId: BOARD_DATASET }, { refetchInterval: poll }),
  );

  if (signals.isError || groups.isError) return <FeatureError name="the trends view" />;
  if (!signals.data || !groups.data) return <BoardGalaxySkeleton />;

  const perHour = new Map(groups.data.map((group) => [group.id, group.velocity]));

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <CorroborationBoard
        signals={signals.data.features.map((feature) => feature.properties)}
        perHour={perHour}
        selectedSignalId={selectedSignalId}
        onSelect={onSelect}
      />
    </div>
  );
}
