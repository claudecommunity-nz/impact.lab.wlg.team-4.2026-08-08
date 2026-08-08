import { ChevronDown, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the client layout. Heading and map frame render for real; Skeleton
 * blocks cover only what we're waiting on — the layer list and the canvas
 * itself.
 */
export function HazardMapSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Wellington hazard map</h1>
          <p className="text-muted-foreground text-sm">
            Council hazard layers on a shared map. Click any feature for its published attributes.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          <Skeleton className="h-3 w-20" />
        </Badge>
      </header>

      <div className="relative h-[36rem] w-full overflow-hidden rounded-lg border">
        {/* Legend frame is real chrome — including its header, which mirrors the
            collapsible trigger so the panel doesn't resize on hydration. */}
        <div className="bg-background/95 absolute top-3 left-3 z-10 w-56 rounded-md border shadow-sm">
          <div className="flex items-center gap-2 px-3 py-2">
            <Layers className="size-3.5 shrink-0" aria-hidden />
            <span className="flex-1 text-xs font-medium">Legend</span>
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </div>
          <div className="space-y-2.5 px-3 pt-0 pb-3">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="size-3 rounded-sm" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="ml-5 h-2.5 w-32" />
              </div>
            ))}
          </div>
        </div>
        <Skeleton className="h-full w-full rounded-none" />
      </div>

      <footer className="space-y-1">
        <Skeleton className="h-2.5 w-80" />
        <Skeleton className="h-2.5 w-64" />
      </footer>
    </div>
  );
}
