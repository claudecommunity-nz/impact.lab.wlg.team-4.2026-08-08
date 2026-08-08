"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { BoardDrillClient } from "@/features/board-drill/board-drill-client";
import { BoardGalaxySkeleton } from "@/features/board-galaxy/board-galaxy-skeleton";
import { BoardMapClient } from "@/features/board-map/board-map-client";
import { BoardBanner, BoardBrand } from "./components/board-chrome";
import { DatasetSwitch } from "./components/dataset-switch";
import { ViewToggle, type BoardView } from "./components/view-toggle";

/**
 * The board's only stateful client: which pane is showing, and which cluster is
 * open in the drill panel. Both are view state, not server state — nothing that
 * comes back from the API is ever copied into useState here; the panes hold
 * their own queries and the drill panel fetches its own detail from the id.
 *
 * three.js is ~600kB before a single point is drawn, so the galaxy is behind a
 * dynamic import with `ssr: false` (WebGL has no server render worth having).
 * The map — the view that always renders — never pays for it.
 */
const BoardGalaxyClient = dynamic(
  () => import("@/features/board-galaxy/board-galaxy-client").then((m) => m.BoardGalaxyClient),
  { ssr: false, loading: () => <BoardGalaxySkeleton /> },
);

export function BoardShellClient({ datasetId }: { datasetId: string }) {
  const [view, setView] = useState<BoardView>("map");
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  // Stable across polls so the map's marker click handlers never need rebinding.
  const select = useCallback((signalId: string | null) => setSelectedSignalId(signalId), []);
  const close = useCallback(() => setSelectedSignalId(null), []);

  return (
    <div className="board-shell dark flex h-dvh max-h-dvh min-h-0 flex-1 flex-col overflow-hidden">
      <header className="board-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <BoardBrand />
        <BoardBanner />
        <div className="flex-1" />
        <DatasetSwitch datasetId={datasetId} />
        <ViewToggle view={view} onChange={setView} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="board-viz relative min-h-0 flex-1">
          {view === "map" ? (
            <BoardMapClient
              datasetId={datasetId}
              selectedSignalId={selectedSignalId}
              onSelect={select}
            />
          ) : (
            <BoardGalaxyClient selectedSignalId={selectedSignalId} onSelect={select} />
          )}
        </div>

        {selectedSignalId !== null && (
          <aside
            aria-label="Signal detail"
            className="drill-panel absolute inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col lg:relative lg:z-auto lg:w-[460px] lg:max-w-none"
          >
            <BoardDrillClient signalId={selectedSignalId} onClose={close} />
          </aside>
        )}
      </div>
    </div>
  );
}
