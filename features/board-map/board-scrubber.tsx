"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pause, Play } from "lucide-react";

/**
 * The time control: drag to see the board as it stood at any moment, press play
 * to watch the picture build. Emits `null` for "live" (the right edge) and an
 * epoch-ms number for any point in the past — the map passes that straight to
 * signals.geojson's asAt, which reconstructs counts and grades from what had
 * actually been captured by then (grade_events + the capture clock).
 *
 * Presentational + local state only; the map owns the query. Play covers the
 * whole capture history in ~45 seconds, then lands back on LIVE.
 */
export function BoardScrubber({
  domainStart,
  value,
  onChange,
}: {
  /** Earliest capture in the current picture (ms epoch). */
  domainStart: number;
  /** Current asAt (ms epoch), or null = live. */
  value: number | null;
  onChange: (asAt: number | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  // Local drag position so the thumb tracks the pointer instantly while the
  // actual query is debounced — one request per settle, not one per pixel.
  const [drag, setDrag] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const now = Date.now();
  const span = Math.max(now - domainStart, 60_000);

  useEffect(() => {
    if (!playing) return;
    const step = span / 45;
    const timer = setInterval(() => {
      const prev = valueRef.current;
      if (prev === null || prev + step >= Date.now()) {
        onChange(null);
        setPlaying(false);
      } else {
        onChange(prev + step);
      }
    }, 1_000);
    return () => clearInterval(timer);
    // span intentionally captured per play-press; re-arming mid-play would stutter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const label =
    value === null
      ? "LIVE"
      : new Date(value).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-card/95 border-border absolute bottom-4 left-1/2 z-10 flex w-[min(480px,80%)] -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 flex-none rounded-full"
        aria-label={playing ? "Pause replay" : "Replay how the picture built up"}
        onClick={() => {
          if (!playing && value === null) onChange(domainStart);
          setPlaying(!playing);
        }}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <input
        type="range"
        aria-label="Time — drag to see the board as it stood at that moment"
        className="accent-primary h-1 flex-1 cursor-pointer"
        min={domainStart}
        max={now}
        step={Math.max(Math.round(span / 200), 1000)}
        value={drag ?? value ?? now}
        onChange={(e) => {
          setPlaying(false);
          const v = Number(e.target.value);
          setDrag(v);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            setDrag(null);
            onChange(now - v < span / 200 ? null : v);
          }, 180);
        }}
      />
      <span
        className={`w-12 flex-none text-right font-mono text-xs ${value === null ? "text-primary font-semibold" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}
