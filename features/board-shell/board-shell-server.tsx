import { Suspense } from "react";
import { ErrorBoundary } from "@/components/errors/error-boundary";
import { FeatureError } from "@/components/errors/feature-error";
import { trpc, HydrateClient } from "@/trpc/server";
import { getQueryClientServer } from "@/utilities/get-query-client-server";
import { BOARD_DATASET } from "./board-dataset";
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
export function Board() {
  return (
    <ErrorBoundary fallback={<FeatureError name="the signal board" />}>
      <Suspense fallback={<BoardShellSkeleton />}>
        <BoardContent />
      </Suspense>
    </ErrorBoundary>
  );
}

async function BoardContent() {
  // AWAITED, unlike the notes reference's fire-and-forget `prefetch()`.
  //
  // An unawaited prefetch dehydrates a query that is still PENDING, so the
  // server renders the map's skeleton while the client — which resolves the
  // streamed data before it hydrates — renders the map. React sees the two
  // trees disagree, throws the server HTML away and regenerates on the client:
  // a hydration error, a flash of grey, and a map that mounts twice.
  //
  // Awaiting costs one round trip inside the Suspense boundary (the shell
  // skeleton covers it) and buys a first paint with real signals on it.
  //
  // The input object must match the client query's exactly, or the entry
  // hydrates under a different key and the map opens empty.
  await getQueryClientServer().prefetchQuery(
    trpc.signals.geojson.queryOptions({ datasetId: BOARD_DATASET }),
  );

  return (
    <HydrateClient>
      <BoardShellClient />
    </HydrateClient>
  );
}
