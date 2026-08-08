"use client";

import type { ReactNode } from "react";
import type { SignalProperties } from "@/components/board/api-types";
import { CredibilityChip, bubbleLabel } from "@/components/board/grade";
import { cn } from "@/lib/utils";

/**
 * One story as a ticker pill.
 *
 * A pill has room for exactly three facts, so each variant leads with the one
 * a duty officer scans for — the rate for a growing story, the count for a
 * much-reported one — and ends with how much to believe it. A pill that shouts
 * "+18/h" without a credibility read is the exact failure this project exists
 * to avoid; everything else the old cards showed (the bar, the source
 * breakdown) is one click away in the drill panel, which opens on this same id.
 */
function SignalPill({
  signalId,
  selected,
  onSelect,
  children,
}: {
  signalId: string;
  selected: boolean;
  onSelect: (signalId: string) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(signalId)}
      className={cn(
        "border-border bg-card focus-visible:ring-ring flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 py-1 transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none",
        selected && "ring-primary ring-2",
      )}
    >
      {children}
    </button>
  );
}

/** A growing story: the rate is the headline. */
export function VelocityPill({
  signal,
  perHour,
  selected,
  onSelect,
}: {
  signal: SignalProperties;
  perHour: number;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  return (
    <SignalPill signalId={signal.signalId} selected={selected} onSelect={onSelect}>
      <span className="text-destructive font-mono text-[12px] font-semibold tabular-nums whitespace-nowrap">
        ▲ +{perHour}/h
      </span>
      <span className="max-w-[220px] truncate text-[12.5px] font-medium">
        {bubbleLabel(signal.label)}
      </span>
      <CredibilityChip grade={signal.grade} className="text-[10px]" />
    </SignalPill>
  );
}

/**
 * A much-reported story: the count leads, and the fraction beside it says how
 * much of that reporting is independent. "14/21 separate" is the same fact the
 * drill panel proves item by item — a count alone cannot distinguish fourteen
 * observations from one post shared twenty times.
 */
export function AgreementPill({
  signal,
  selected,
  onSelect,
}: {
  signal: SignalProperties;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  return (
    <SignalPill signalId={signal.signalId} selected={selected} onSelect={onSelect}>
      <span className="font-mono text-[12px] font-semibold tabular-nums">{signal.itemCount}×</span>
      <span className="max-w-[220px] truncate text-[12.5px] font-medium">
        {bubbleLabel(signal.label)}
      </span>
      <span className="text-muted-foreground shrink-0 text-[11px]">
        <span className="font-mono tabular-nums">
          {signal.independentSources}/{signal.itemCount}
        </span>{" "}
        separate
      </span>
    </SignalPill>
  );
}
