import { Suspense } from "react";
import { ErrorBoundary } from "@/components/errors/error-boundary";
import { FeatureError } from "@/components/errors/feature-error";
import { trpc, prefetch, HydrateClient } from "@/trpc/server";
import { MAP_LAYER_IDS } from "./map-layers";
import { HazardMapClient } from "./hazard-map-client";
import { HazardMapSkeleton } from "./hazard-map-skeleton";

/**
 * The feature entry. Both layers prefetch in parallel through the RSC proxy, so
 * the legend and attribution are real on first paint even though the canvas
 * itself can only mount in the browser.
 */
export function HazardMap() {
  return (
    <ErrorBoundary fallback={<FeatureError name="the hazard map" />}>
      <Suspense fallback={<HazardMapSkeleton />}>
        <HazardMapContent />
      </Suspense>
    </ErrorBoundary>
  );
}

async function HazardMapContent() {
  for (const datasetId of MAP_LAYER_IDS) {
    prefetch(trpc.gis.layer.queryOptions({ datasetId }));
  }

  return (
    <HydrateClient>
      <HazardMapClient />
    </HydrateClient>
  );
}
