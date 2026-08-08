"use client";

import type { GalaxyGroup } from "@/components/board/api-types";
import { bubbleLabel, humanizeLabel } from "@/components/board/grade";
import { WELLINGTON_MAX_BOUNDS } from "@/features/hazard-map/components/basemap";
import { cn } from "@/lib/utils";

/**
 * The trend view: which stories are big, and which are getting bigger fastest.
 *
 * This replaced a three.js point cloud of PCA-projected embeddings. That view
 * was honest about the maths and useless in a room: the axes were principal
 * components, so "left" and "up" meant nothing anybody could say out loud, and
 * it failed opaquely when WebGL misbehaved. Here both axes are quantities an
 * operator already has words for.
 *
 * The hard problem is not drawing it, it is REFUSING to draw most of it. A live
 * feed is overwhelmingly singletons, they all land in the same corner, and the
 * first version rendered every one with a label — a black smear of overlapping
 * text in the bottom-left while two real stories floated in empty space. So:
 * the tail is culled to a count, the survivors set the scale, and only the
 * leaders get names.
 */

/** Where the eye should land: many reports, arriving fast. */
const HOT_QUADRANT_TINT = "look-here";
const PADDING = { top: 30, right: 48, bottom: 48, left: 56 };

/** A cluster one person reported is not yet a trend. */
const MIN_REPORTS = 2;
/** Past this many bubbles the field stops being readable at a glance. */
const MAX_BUBBLES = 14;
/** Labels are the scarcest resource on this chart. */
const MAX_LABELS = 5;

/** Same ground the map covers, so the two modes tell one story. */
const [[MIN_LNG, MIN_LAT], [MAX_LNG, MAX_LAT]] = WELLINGTON_MAX_BOUNDS;

function inRegion(group: GalaxyGroup): boolean {
  const at = group.geoCentroid;
  // A cluster nobody could place is still a trend — it is only undrawable on a
  // map, which is a different question from whether it belongs to this city.
  if (!at) return true;
  return at.lng >= MIN_LNG && at.lng <= MAX_LNG && at.lat >= MIN_LAT && at.lat <= MAX_LAT;
}

export function BubbleField({
  groups,
  selectedSignalId,
  onSelect,
}: {
  groups: GalaxyGroup[];
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const regional = groups.filter(inRegion);
  const ranked = [...regional].sort(
    (a, b) => b.memberCount - a.memberCount || b.velocity - a.velocity,
  );
  const shown = ranked.filter((g) => g.memberCount >= MIN_REPORTS).slice(0, MAX_BUBBLES);
  const hidden = regional.length - shown.length;

  if (shown.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 text-sm">
        <p>No cluster has more than one report yet.</p>
        {hidden > 0 && (
          <p className="text-[12px]">
            {hidden} single-report {hidden === 1 ? "group" : "groups"} are on the map.
          </p>
        )}
      </div>
    );
  }

  const width = 1000;
  const height = 600;
  const plot = {
    x: PADDING.left,
    y: PADDING.top,
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  };

  // Axes are scaled to the SURVIVORS, not to the whole feed. Scaling to a tail
  // that is no longer drawn is what left two bubbles in an empty field.
  const counts = shown.map((g) => g.memberCount);
  const rates = shown.map((g) => g.velocity);
  const span = (values: number[]) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    return { low, range: Math.max(high - low, 1) };
  };
  const count = span(counts);
  const rate = span(rates);
  const busiest = Math.max(...counts);

  // Quiet clusters land on top of each other in the same corner, so their
  // labels do too. Nudge each one below any label already occupying that
  // column — cheap, deterministic, and enough at this bubble count.
  const labelRows: { x: number; y: number }[] = [];
  const clearRow = (x: number, y: number) => {
    let row = y;
    while (labelRows.some((taken) => Math.abs(taken.x - x) < 150 && Math.abs(taken.y - row) < 30)) {
      row += 30;
    }
    labelRows.push({ x, y: row });
    return row;
  };

  const placed = shown.map((group, index) => {
    const mass = (group.memberCount - count.low) / count.range;
    const heat = (group.velocity - rate.low) / rate.range;
    return {
      group,
      featured: index < MAX_LABELS,
      cx: plot.x + plot.w * (0.1 + 0.8 * heat),
      cy: plot.y + plot.h * (0.9 - 0.8 * mass),
      r: 12 + 40 * Math.sqrt(group.memberCount / busiest),
      fill: heat > 0.66 ? "var(--destructive)" : heat > 0.33 ? "var(--warning)" : "var(--primary)",
    };
  });

  // Label rows are reserved in draw order, so the biggest clusters keep the row
  // closest to their own bubble and the small ones move.
  const labelled = new Map<string, number>();
  for (const spot of placed) {
    if (!spot.featured) continue;
    labelled.set(spot.group.id, clearRow(spot.cx, spot.cy + spot.r + 17));
  }

  return (
    <div className="flex h-full flex-col">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-h-0 w-full flex-1"
        role="group"
        aria-label="Clusters by how many reports and how fast they are arriving"
      >
        <defs>
          <radialGradient id={HOT_QUADRANT_TINT} cx="100%" cy="0%" r="80%">
            <stop offset="0%" stopColor="var(--destructive)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--destructive)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect
          x={plot.x}
          y={plot.y}
          width={plot.w}
          height={plot.h}
          fill={`url(#${HOT_QUADRANT_TINT})`}
        />
        <line
          x1={plot.x}
          y1={plot.y + plot.h}
          x2={plot.x + plot.w}
          y2={plot.y + plot.h}
          stroke="var(--border)"
        />
        <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.h} stroke="var(--border)" />

        <text x={plot.x} y={plot.y - 12} className="fill-muted-foreground text-[13px] font-semibold">
          ↑ more reports
        </text>
        <text
          x={plot.x + plot.w}
          y={plot.y + plot.h + 32}
          textAnchor="end"
          className="fill-muted-foreground text-[13px] font-semibold"
        >
          arriving faster →
        </text>

        {placed.map(({ group, featured, cx, cy, r, fill }) => {
          const selected = group.id === selectedSignalId;
          const named = featured || selected;
          return (
            <g
              key={group.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`${humanizeLabel(group.label)}, ${group.memberCount} reports, ${group.velocity} an hour`}
              onClick={() => onSelect(group.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(group.id);
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              <title>{`${humanizeLabel(group.label)} — ${group.memberCount} reports`}</title>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={named ? fill : "var(--muted-foreground)"}
                fillOpacity={selected ? 0.5 : named ? 0.3 : 0.18}
                stroke={named ? fill : "var(--muted-foreground)"}
                strokeWidth={selected ? 3 : 1.5}
              />
              {named && (
                <>
                  <text
                    x={cx}
                    y={labelled.get(group.id) ?? cy + r + 17}
                    textAnchor="middle"
                    className={cn(
                      "fill-foreground text-[13px]",
                      selected ? "font-bold" : "font-semibold",
                    )}
                  >
                    {bubbleLabel(group.label)}
                  </text>
                  <text
                    x={cx}
                    y={(labelled.get(group.id) ?? cy + r + 17) + 15}
                    textAnchor="middle"
                    className="fill-muted-foreground font-mono text-[12px]"
                  >
                    {group.memberCount} reports
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {hidden > 0 && (
        <p className="text-muted-foreground shrink-0 pt-1 text-center text-[12px]">
          {hidden} quieter {hidden === 1 ? "group" : "groups"} hidden — every one is still on
          the map.
        </p>
      )}
    </div>
  );
}
