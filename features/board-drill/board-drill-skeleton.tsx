import { Skeleton } from "@/components/ui/skeleton";

/**
 * The drill panel while `signals.detail` is in flight. The section headings are
 * true whatever comes back, so they render for real; only the evidence itself
 * is greyed out.
 */
export function BoardDrillSkeleton() {
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <Skeleton className="h-6 w-40" />

      <section className="space-y-1.5">
        <h3 className="board-muted font-mono text-[10px] tracking-[0.12em] uppercase">
          Why it is graded this way
        </h3>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-[86px] rounded-md" />
        <Skeleton className="h-[86px] rounded-md" />
      </div>

      <section className="space-y-2">
        <h3 className="board-muted font-mono text-[10px] tracking-[0.12em] uppercase">
          Provenance
        </h3>
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-1.5 py-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </section>
    </div>
  );
}
