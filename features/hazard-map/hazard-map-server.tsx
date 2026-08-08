import { Suspense } from "react";
import { ErrorBoundary } from "@/components/errors/error-boundary";
import { FeatureError } from "@/components/errors/feature-error";
import { trpc, prefetch, HydrateClient } from "@/trpc/server";
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
  prefetch(trpc.gis.layer.queryOptions({ datasetId: "ponding-areas" }));
  prefetch(trpc.gis.layer.queryOptions({ datasetId: "community-emergency-hubs" }));

  return (
    <HydrateClient>
      <HazardMapClient />
    </HydrateClient>
  );
}
