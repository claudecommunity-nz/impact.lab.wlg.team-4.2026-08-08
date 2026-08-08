import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton rule: the lane headings are true before any data arrives, so they
 * render for real and only the pills grey out.
 */
export function BoardLanesSkeleton() {
  return (
    <div className="border-border bg-background flex h-11 shrink-0 items-center gap-2 overflow-hidden border-b px-4">
      <h2 className="text-muted-foreground shrink-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
        Picking up speed
      </h2>
      {[0, 1, 2].map((pill) => (
        <Skeleton key={pill} className="h-7 w-44 shrink-0 rounded-full" />
      ))}
      <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
      <h2 className="text-muted-foreground shrink-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
        Most talked about
      </h2>
      {[0, 1].map((pill) => (
        <Skeleton key={pill} className="h-7 w-44 shrink-0 rounded-full" />
      ))}
    </div>
  );
}
