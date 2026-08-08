"use client";

import type { SignalProperties } from "@/components/board/api-types";
import { CredibilityChip, bubbleLabel, localityOf } from "@/components/board/grade";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One story that is growing, and how fast.
 *
 * The rate is the headline because it is the thing a duty officer cannot get
 * from a map: a cluster of six that arrived in the last hour needs attention
 * before a cluster of twenty that stopped growing yesterday.
 *
 * The credibility chip sits on the card rather than being implied by it. A
 * card that shouts "+18/h" without saying how much to believe it is the exact
 * failure this project exists to avoid.
 */
export function VelocityCard({
  signal,
  perHour,
  hottest,
  selected,
  onSelect,
}: {
  signal: SignalProperties;
  perHour: number;
  hottest: number;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  const share = Math.max(0.08, perHour / Math.max(hottest, 1));

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(signal.signalId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(signal.signalId);
        }
      }}
      className={cn(
        "focus-visible:ring-ring min-w-0 flex-1 cursor-pointer gap-0 p-3 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none",
        selected && "ring-primary ring-2",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] font-semibold">{bubbleLabel(signal.label)}</p>
        <p className="text-destructive shrink-0 font-mono text-[15px] font-semibold tabular-nums">
          +{perHour}/h
        </p>
      </div>

      <p className="text-muted-foreground mt-0.5 truncate text-[11.5px]">
        {localityOf(signal.label)}
      </p>

      {/* A bar, not a sparkline: we hold no per-hour history to draw, and a
          fabricated curve would be a lie about data we do not have. */}
      <div className="bg-muted mt-2.5 h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-destructive h-full rounded-full"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <p className="text-muted-foreground font-mono text-[11px] tabular-nums">
          {signal.itemCount} reports · {signal.sourceClasses.length} kinds of source
        </p>
        <CredibilityChip grade={signal.grade} className="shrink-0 text-[10.5px]" />
      </div>
    </Card>
  );
}
