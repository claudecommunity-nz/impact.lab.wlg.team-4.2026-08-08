import { CredibilityLegend } from "@/components/board/grade";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The map pane while its GeoJSON is in flight. The legend is chrome and renders
 * for real; the dark field stands in for the basemap, which is also roughly what
 * the real map looks like before tiles arrive.
 */
export function BoardMapSkeleton() {
  return (
    <div className="absolute inset-0">
      <Skeleton className="absolute inset-0 rounded-none opacity-40" />
      <div className="bg-card border-border absolute bottom-3 left-3 rounded-lg border p-2.5">
        <CredibilityLegend />
      </div>
      <p className="text-muted-foreground/80 absolute top-3 right-4 font-mono text-[10px]">loading signals…</p>
    </div>
  );
}
