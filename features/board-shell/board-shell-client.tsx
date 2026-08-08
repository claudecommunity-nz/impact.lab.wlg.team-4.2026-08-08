"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { ErrorBoundary } from "@/components/errors/error-boundary";
import { FeatureError } from "@/components/errors/feature-error";
import { BoardDrillClient } from "@/features/board-drill/board-drill-client";
import { BoardGalaxySkeleton } from "@/features/board-galaxy/board-galaxy-skeleton";
import { BoardMapClient } from "@/features/board-map/board-map-client";
import { cn } from "@/lib/utils";
import { BOARD_DATASET } from "./board-dataset";
import { BoardBanner, BoardBrand } from "./components/board-chrome";
import { ViewToggle, type BoardView } from "./components/view-toggle";

/**
 * ONE scene, two modes.
 *
 * The map and the galaxy are not two pages and not two tabs — they are the same
 * signals laid out two ways, and the board is built so an operator never feels
 * they left. Both modes stay MOUNTED and cross-fade: the map keeps its camera,
 * the galaxy keeps its orbit, the selection carries across, and the same drill
 * panel serves whichever mode is showing. Unmounting on every toggle would
 * reset the map's position and re-run three.js's whole setup, which is exactly
 * the "I've gone somewhere else" feeling this is meant to avoid.
 *
 * Selection and mode are view state, not server state — nothing that comes back
 * from the API is copied into useState here. The modes hold their own queries
 * and the drill panel fetches its own detail from the id.
 *
 * three.js is ~600kB before a single point is drawn, so the galaxy is behind a
 * dynamic import with `ssr: false` (WebGL has no server render worth having)
 * and is not mounted at all until the operator first asks for it.
 */
const BoardGalaxyClient = dynamic(
  () => import("@/features/board-galaxy/board-galaxy-client").then((m) => m.BoardGalaxyClient),
  { ssr: false, loading: () => <BoardGalaxySkeleton /> },
);

export function BoardShellClient() {
  const [view, setView] = useState<BoardView>("map");
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  // Once the galaxy has been asked for it stays mounted, so switching back is
  // instant and the orbit an operator set up is still there. Mounting is driven
  // by the operator's click rather than by an effect watching `view` — the
  // click is the actual cause, and an effect would only re-derive it a render
  // later.
  const [trendsMounted, setTrendsMounted] = useState(false);
  const changeView = useCallback((next: BoardView) => {
    if (next === "trends") setTrendsMounted(true);
    setView(next);
  }, []);

  // Stable across polls so the map's marker click handlers never need rebinding.
  const select = useCallback((signalId: string | null) => setSelectedSignalId(signalId), []);
  const close = useCallback(() => setSelectedSignalId(null), []);

  return (
    <div className="bg-background text-foreground flex h-dvh max-h-dvh min-h-0 flex-1 flex-col overflow-hidden">
      <header className="bg-card border-border flex h-[62px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4">
        <BoardBrand />
        <BoardBanner />
        <div className="flex-1" />
        <ViewToggle view={view} onChange={changeView} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="board-map bg-muted relative min-h-0 flex-1">
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-300",
              view === "trends" && "pointer-events-none opacity-0",
            )}
            aria-hidden={view === "trends"}
          >
            {/* Per-mode boundaries: a map that fails must cost the operator the
                map, not the header, the galaxy and the open evidence panel. */}
            <ErrorBoundary fallback={<FeatureError name="the map" />}>
              <BoardMapClient
                datasetId={BOARD_DATASET}
                selectedSignalId={selectedSignalId}
                onSelect={select}
              />
            </ErrorBoundary>
          </div>

          {trendsMounted && (
            <div
              className={cn(
                "absolute inset-0 transition-opacity duration-300",
                view === "map" && "pointer-events-none opacity-0",
              )}
              aria-hidden={view === "map"}
            >
              <ErrorBoundary fallback={<FeatureError name="the galaxy" />}>
                <BoardGalaxyClient
                  active={view === "trends"}
                  selectedSignalId={selectedSignalId}
                  onSelect={select}
                />
              </ErrorBoundary>
            </div>
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
