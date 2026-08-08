import { Skeleton } from "@/components/ui/skeleton";

/**
 * The trends mode while its stories are in flight. The title and stance are
 * chrome — true whatever comes back — so they render for real; the cards and
 * rail grey out in the same two-column shape the live board draws.
 */
export function BoardGalaxySkeleton() {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5 p-5">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-heading text-[15px] font-bold tracking-[0.05em] uppercase">
            Matters needing confirmation
          </h2>
          <p className="text-muted-foreground text-[12px]">public reports, not verified facts</p>
        </header>
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-[124px] w-full rounded-xl" />
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-[46px] w-full rounded-lg" />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-[52px] w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
