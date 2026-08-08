import { HazardMap } from "@/features/hazard-map/hazard-map-server";

// Council GIS is fetched per request — never prerender this at build.
export const dynamic = "force-dynamic";

/** Pages are trivially thin: compose feature entries, nothing else. */
export default function MapPage() {
  return (
    <main className="flex-1">
      <HazardMap />
    </main>
  );
}
