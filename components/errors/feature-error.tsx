/**
 * Shared default error state for feature blocks. Features only write their own
 * -error component when they need specific messaging or recovery actions.
 */
export function FeatureError({ name }: { name: string }) {
  return (
    <div className="flex w-full items-center justify-center p-6">
      <p className="text-destructive text-sm">
        Couldn&apos;t load {name}. Refresh to try again.
      </p>
    </div>
  );
}
