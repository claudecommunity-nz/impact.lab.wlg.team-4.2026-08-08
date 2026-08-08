import type { SignalDetail } from "@/components/board/api-types";

/**
 * Why items were judged to be the SAME observation, in the matcher's own words.
 *
 * This is the difference between asserting "we de-duplicate" and showing the
 * working. "Seven reports of flooding" and "seven copies of one report of
 * flooding" look identical in a feed and mean opposite things to a duty
 * officer, so the sentence that collapsed them is evidence in its own right and
 * belongs on screen next to the count it explains.
 *
 * Only collapsed origins are listed. An origin holding a single item explains
 * nothing — it is just an item — and printing a row per item would bury the two
 * or three that matter.
 */
export function CollapsedOrigins({ originGroups }: { originGroups: SignalDetail["originGroups"] }) {
  const collapsed = originGroups.filter((group) => group.itemIds.length > 1);
  if (collapsed.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
        Why these were counted once
      </h3>
      <ul className="space-y-2">
        {collapsed.map((group) => (
          <li
            key={group.originId}
            className="bg-muted border-border rounded-md border px-2.5 py-2"
          >
            <p className="font-mono text-[10.5px] font-semibold" style={{ color: "#fbbf24" }}>
              {group.itemIds.length} items → 1 origin
            </p>
            {group.reasons.length === 0 ? (
              <p className="text-muted-foreground/80 mt-1 text-[11px]">No reason recorded.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {group.reasons.map((reason) => (
                  <li key={reason} className="text-[11.5px] leading-relaxed">
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
