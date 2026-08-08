"use client";

import type { UnmappableSignal } from "@/components/board/api-types";

/**
 * Clusters we hold evidence for but cannot place.
 *
 * This strip exists because the alternative is a lie: a map that silently drops
 * what it cannot geolocate reads as "nothing is happening there". A report with
 * only "Aro Valley" in its text is still evidence — it is only undrawable — so
 * it sits in a gutter with a live count and opens the same drill panel as any
 * marker on the map.
 */
export function UnmappableGutter({
  entries,
  onSelect,
}: {
  entries: UnmappableSignal[];
  onSelect: (signalId: string) => void;
}) {
  if (entries.length === 0) return null;

  const items = entries.reduce((total, entry) => total + entry.itemCount, 0);

  return (
    <div className="board-panel pointer-events-auto max-w-[300px] rounded-lg border p-2.5">
      <p className="board-muted font-mono text-[10px] tracking-[0.12em] uppercase">
        No location · {entries.length}{" "}
        {entries.length === 1 ? "signal" : "signals"} · {items}{" "}
        {items === 1 ? "item" : "items"}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <li key={entry.signalId}>
            <button
              type="button"
              onClick={() => onSelect(entry.signalId)}
              className="board-line board-muted board-toggle rounded-md border px-2 py-1 font-mono text-[10px]"
              title="Held, but not placeable on the map — open the evidence"
            >
              {entry.signalId.slice(0, 8)} · {entry.itemCount}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
