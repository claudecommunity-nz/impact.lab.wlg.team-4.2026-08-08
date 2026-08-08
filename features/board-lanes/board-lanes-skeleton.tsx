import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton rule: the lane headings are true before any data arrives, so they
 * render for real and only the cards grey out.
 */
export function BoardLanesSkeleton() {
  return (
    <div className="border-border bg-background flex shrink-0 flex-col gap-4 border-b px-4 py-3 lg:flex-row">
      <section className="min-w-0 flex-1">
        <h2 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.1em] uppercase">
          Picking up speed
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          {[0, 1, 2].map((card) => (
            <Skeleton key={card} className="h-[104px] flex-1 rounded-xl" />
          ))}
        </div>
      </section>
      <section className="min-w-0">
        <h2 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.1em] uppercase">
          Most talked about
        </h2>
        <div className="flex w-full flex-col gap-2 lg:w-[376px]">
          <Skeleton className="h-[92px] rounded-xl" />
          <Skeleton className="h-[92px] rounded-xl" />
        </div>
      </section>
    </div>
  );
}
