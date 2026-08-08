import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown twice: while three.js is being fetched (the pane is dynamically
 * imported) and while the point cloud is in flight. The caption is chrome and
 * true in both cases, so it renders for real.
 */
export function BoardGalaxySkeleton() {
  return (
    <div className="absolute inset-0">
      <Skeleton className="absolute inset-0 rounded-none opacity-30" />
      <div className="bg-card border-border absolute top-3 left-3 w-[250px] rounded-lg border p-2">
        <p className="text-muted-foreground px-1 pb-1.5 font-mono text-[10px] tracking-[0.12em] uppercase">
          Clusters
        </p>
        <div className="space-y-1.5 p-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
      <p className="text-muted-foreground/80 absolute top-3 right-4 font-mono text-[10px]">
        Position = what was said, not where.
      </p>
    </div>
  );
}
