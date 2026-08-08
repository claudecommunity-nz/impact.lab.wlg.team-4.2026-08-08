import { Suspense } from "react";
import { ErrorBoundary } from "@/components/errors/error-boundary";
import { FeatureError } from "@/components/errors/feature-error";
import { trpc, prefetch, HydrateClient } from "@/trpc/server";
import { BoardShellClient } from "./board-shell-client";
import { BoardShellSkeleton } from "./board-shell-skeleton";

/**
 * The board's feature entry, and the composition root for the whole route.
 *
 * The shell — not board-map — owns the prefetch and the HydrateClient because
 * the panes are swapped by a client-side toggle and the drill panel is opened
 * by a click: their ids do not exist at request time, so they cannot each have
 * a -server half of their own. What CAN be server-rendered is the opening view,
 * and it is: the map's GeoJSON is prefetched here and hydrates straight into
 * BoardMapClient's useQuery, so the first paint carries real signals.
 *
 * The galaxy is deliberately NOT prefetched. It is behind a toggle and behind a
 * dynamic import, and paying for three.js plus a point cloud on a request that
 * may only ever show the map would slow down the one view that always renders.
 */
export function Board({ datasetId }: { datasetId: string }) {
  return (
    <ErrorBoundary fallback={<FeatureError name="the signal board" />}>
      <Suspense fallback={<BoardShellSkeleton />}>
        <BoardContent datasetId={datasetId} />
      </Suspense>
    </ErrorBoundary>
  );
}

async function BoardContent({ datasetId }: { datasetId: string }) {
  // The SAME input object the client query builds, or the prefetched entry
  // would hydrate under a different key and the first paint would be empty.
  prefetch(trpc.signals.geojson.queryOptions({ datasetId }));

  return (
    <HydrateClient>
      <BoardShellClient datasetId={datasetId} />
    </HydrateClient>
  );
}
