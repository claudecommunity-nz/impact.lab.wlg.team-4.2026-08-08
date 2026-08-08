import { Skeleton } from "@/components/ui/skeleton";

/**
 * The trends mode while its clusters are in flight. The caption is chrome and
 * true whatever comes back, so it renders for real.
 */
export function BoardGalaxySkeleton() {
  return (
    <div className="absolute inset-0 flex flex-col p-4">
      <p className="text-muted-foreground shrink-0 text-[12px]">
        Every cluster by how much has been reported and how fast it is still arriving.
        Top-right is where to look first.
      </p>
      <Skeleton className="mt-3 min-h-0 flex-1 rounded-xl" />
    </div>
  );
}
