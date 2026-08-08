"use client";

import type { GalaxyGroup } from "@/components/board/api-types";
import { groupColour } from "./galaxy-palette";

/**
 * The bubbles as a list, beside the same bubbles as spheres.
 *
 * A WebGL scene has no accessible names and cannot be tabbed through, so every
 * cluster you can click in the galaxy is also a real button here, carrying the
 * numbers the sphere can only imply: how many members, how many distinct source
 * classes, and how fast it is growing.
 */
export function ClusterList({
  groups,
  selectedSignalId,
  onSelect,
}: {
  groups: GalaxyGroup[];
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="board-panel absolute top-3 left-3 z-10 max-h-[70%] w-[250px] overflow-y-auto rounded-lg border p-2">
      <p className="board-muted px-1 pb-1.5 font-mono text-[10px] tracking-[0.12em] uppercase">
        Clusters · {groups.length}
      </p>
      <ul className="space-y-0.5">
        {groups.map((group) => {
          const selected = group.id === selectedSignalId;
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => onSelect(group.id)}
                aria-pressed={selected}
                className="board-toggle flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left"
                style={selected ? { background: "var(--board-accent-dim)" } : undefined}
              >
                <span
                  aria-hidden
                  className="mt-1 size-2.5 shrink-0 rounded-full"
                  style={{ background: groupColour(group.id) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-semibold">
                    {group.label ?? `Cluster ${group.id.slice(0, 8)}`}
                  </span>
                  <span className="board-faint block font-mono text-[10px] tabular-nums">
                    {group.memberCount} members · {group.sourceDiversity} source{" "}
                    {group.sourceDiversity === 1 ? "class" : "classes"}
                    {group.velocity > 0 && ` · +${group.velocity}/h`}
                  </span>
                  {group.memberCount !== group.size && (
                    <span className="block font-mono text-[9.5px]" style={{ color: "#fbbf24" }}>
                      cache disagrees with edges ({group.size})
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
