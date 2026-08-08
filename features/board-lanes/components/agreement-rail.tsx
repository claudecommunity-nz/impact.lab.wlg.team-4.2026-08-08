"use client";

import type { SignalProperties } from "@/components/board/api-types";
import { bubbleLabel } from "@/components/board/grade";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * The most-reported stories, and how much of that reporting is actually
 * independent.
 *
 * The bar is the point. A cluster of twenty-one where fourteen are separate
 * observations is a different thing from a cluster of twenty-one that is one
 * post shared twenty times, and the two are indistinguishable from a count
 * alone. This is the same fact the drill panel proves item by item, drawn
 * small enough to read from across a room.
 */
export function AgreementRail({
  signals,
  selectedSignalId,
  onSelect,
}: {
  signals: SignalProperties[];
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 lg:w-[376px]">
      {signals.map((signal) => {
        const share = Math.round((signal.independentSources / Math.max(signal.itemCount, 1)) * 100);
        const selected = signal.signalId === selectedSignalId;

        return (
          <Card
            key={signal.signalId}
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
              "focus-visible:ring-ring cursor-pointer gap-0 p-3 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none",
              selected && "ring-primary ring-2",
            )}
          >
            <div className="flex items-baseline gap-2.5">
              <p className="font-mono text-2xl leading-none font-semibold tabular-nums">
                {signal.itemCount}
              </p>
              <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {bubbleLabel(signal.label)}
              </p>
            </div>

            <Progress value={share} className="mt-2.5 h-1.5" />

            <p className="text-muted-foreground mt-1.5 text-[11.5px]">
              <span className="font-mono tabular-nums">{signal.independentSources}</span> of{" "}
              <span className="font-mono tabular-nums">{signal.itemCount}</span> are separate
              observations
              {signal.independentSources < signal.itemCount && " — the rest repeat each other"}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
