"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pause, Play } from "lucide-react";

/** Replaying the whole capture history, end to end. */
const PLAY_SECONDS = 30;

/** How often the server is asked for a new instant while the thumb glides. */
const EMIT_MS = 300;

/**
 * The time control: drag to see the board as it stood at any moment, press play
 * to watch the picture build. Emits `null` for "live" (the right edge) and an
 * epoch-ms number for any point in the past — the map passes that straight to
 * signals.geojson's asAt, which reconstructs counts and grades from what had
 * actually been captured by then (grade_events + the capture clock).
 *
 * Presentational + local state only; the map owns the query. The thumb moves at
 * frame rate — pointer tracking while dragging, a requestAnimationFrame loop
 * while playing — and the server is asked for a new instant at most every
 * EMIT_MS, quantised to a fixed grid so ground already scrubbed over answers
 * from the query cache instead of the network.
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
  // The thumb's own position while dragging or playing; null = follow `value`.
  const [thumb, setThumb] = useState<number | null>(null);
  const thumbRef = useRef(thumb);
  thumbRef.current = thumb;
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const now = Date.now();
  const span = Math.max(now - domainStart, 60_000);
  // Frozen on mount so the quantisation grid never shifts under the cache.
  const stepRef = useRef<number | null>(null);
  if (stepRef.current === null) stepRef.current = Math.max(Math.round(span / 200), 1_000);
  const stepMs = stepRef.current;

  const quantise = (v: number) => domainStart + Math.round((v - domainStart) / stepMs) * stepMs;

  /** Throttled unless forced; forced emits also reset the throttle window. */
  const emit = (v: number | null, force = false) => {
    const t = performance.now();
    if (!force && t - lastEmitRef.current < EMIT_MS) return;
    lastEmitRef.current = t;
    onChangeRef.current(v === null ? null : quantise(v));
  };

  useEffect(() => {
    if (!playing) return;
    const begin = valueRef.current ?? domainStart;
    const liveEdge = Date.now();
    const distance = Math.max(liveEdge - begin, 1);
    // Constant speed across the track: resuming near the end stays short.
    const durationMs = (PLAY_SECONDS * 1_000 * distance) / Math.max(liveEdge - domainStart, 1);
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / durationMs, 1);
      if (p >= 1) {
        setThumb(null);
        emit(null, true);
        setPlaying(false);
        return;
      }
      const v = begin + distance * p;
      setThumb(v);
      emit(v);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The run is measured out per play-press; re-arming mid-play would stutter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  useEffect(
    () => () => {
      if (settleRef.current) clearTimeout(settleRef.current);
    },
    [],
  );

  const shown = thumb ?? value;
  const label =
    shown === null
      ? "LIVE"
      : new Date(shown).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-card/95 border-border absolute bottom-4 left-1/2 z-10 flex w-[min(480px,80%)] -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 shadow-sm">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 flex-none rounded-full"
        aria-label={playing ? "Pause replay" : "Replay how the picture built up"}
        onClick={() => {
          if (playing) {
            // Freeze the picture where the replay stands, then let go of it.
            if (thumbRef.current !== null) emit(thumbRef.current, true);
            setThumb(null);
            setPlaying(false);
          } else {
            if (valueRef.current === null) emit(domainStart, true);
            setPlaying(true);
          }
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
        step={stepMs}
        value={thumb ?? value ?? now}
        onChange={(e) => {
          setPlaying(false);
          const v = Number(e.target.value);
          setThumb(v);
          // The picture chases the thumb while it moves...
          emit(v);
          if (settleRef.current) clearTimeout(settleRef.current);
          settleRef.current = setTimeout(() => {
            // ...and the instant you stopped on always lands, throttle or not.
            setThumb(null);
            emit(now - v < span / 200 ? null : v, true);
          }, 160);
        }}
      />
      <span
        className={`w-12 flex-none text-right font-mono text-xs ${shown === null ? "text-primary font-semibold" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}
