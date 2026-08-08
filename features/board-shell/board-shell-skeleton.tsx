import { CredibilityLegend } from "@/components/board/grade";
import { Skeleton } from "@/components/ui/skeleton";
import { BoardBanner, BoardBrand } from "./components/board-chrome";

/**
 * Skeleton rule: only the awaited data gets Skeleton blocks. The top bar, the
 * standing caveat and the credibility legend are chrome — they are true before
 * any signal arrives, so they render for real. The pane is what we are waiting
 * on, so the pane is what greys out.
 */
export function BoardShellSkeleton() {
  return (
    <div className="board-shell dark flex h-dvh max-h-dvh min-h-0 flex-1 flex-col overflow-hidden">
      <header className="board-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <BoardBrand />
        <BoardBanner />
        <div className="flex-1" />
        {/* The view toggle is real chrome, but inert until the board is live. */}
        <div className="board-line flex overflow-hidden rounded-lg border opacity-50">
          <span className="board-muted px-3.5 py-1.5 text-[11.5px] font-semibold">Map</span>
          <span className="board-muted px-3.5 py-1.5 text-[11.5px] font-semibold">Galaxy</span>
        </div>
      </header>

      <div className="board-viz relative min-h-0 flex-1 p-4">
        <Skeleton className="h-full w-full rounded-lg" />
        <div className="board-panel absolute bottom-6 left-6 rounded-lg border p-3">
          <CredibilityLegend />
        </div>
      </div>
    </div>
  );
}
