"use client";

import type { GalaxyGroup } from "@/components/board/api-types";
import { humanizeLabel, localityOf } from "@/components/board/grade";
import { cn } from "@/lib/utils";

/**
 * The trend view: which stories are big, and which are getting bigger fastest.
 *
 * This replaced a three.js point cloud of PCA-projected embeddings. That view
 * was honest about the maths and useless in a room: the axes were principal
 * components, so "left" and "up" meant nothing anybody could say out loud, and
 * it failed opaquely when WebGL misbehaved. Here both axes are quantities an
 * operator already has words for — how many reports, and how fast they are
 * arriving — and it is plain SVG, so it cannot fail in a way you cannot see.
 *
 * Position is the message; size repeats the y-axis deliberately, because a big
 * circle high on the chart is the thing to look at first and saying it twice is
 * how you make that unmissable in four seconds.
 */

/** Where the eye should land: many reports, arriving fast. */
const HOT_QUADRANT_TINT = "look-here";

const PADDING = { top: 28, right: 40, bottom: 44, left: 52 };

/**
 * How many reports a cluster needs before it is named here.
 *
 * A live feed is mostly singletons, and they all land in the same corner —
 * fewest reports, slowest arrival. Naming every one of them stacks forty labels
 * on top of each other and hides the two or three clusters this view exists to
 * surface. Unnamed bubbles are still drawn, still sized, still clickable.
 */
const LABEL_FROM_REPORTS = 2;

export function BubbleField({
  groups,
  selectedSignalId,
  onSelect,
}: {
  groups: GalaxyGroup[];
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Nothing clustered yet.
      </div>
    );
  }

  const busiest = Math.max(...groups.map((group) => group.size), 1);
  const fastest = Math.max(...groups.map((group) => group.velocity), 1);

  // A viewBox rather than pixel maths: the field scales to whatever space the
  // mode is given without a resize observer.
  const width = 1000;
  const height = 620;
  const plot = {
    x: PADDING.left,
    y: PADDING.top,
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  };

  const placed = groups.map((group) => {
    const heat = group.velocity / fastest;
    const mass = group.size / busiest;
    return {
      group,
      cx: plot.x + plot.w * (0.08 + 0.84 * heat),
      cy: plot.y + plot.h * (0.92 - 0.84 * mass),
      r: 10 + 44 * Math.sqrt(mass),
      fill: heat > 0.66 ? "var(--destructive)" : heat > 0.33 ? "var(--warning)" : "var(--primary)",
    };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="group"
      aria-label="Clusters by how many reports and how fast they are arriving"
    >
      <defs>
        <radialGradient id={HOT_QUADRANT_TINT} cx="100%" cy="0%" r="85%">
          <stop offset="0%" stopColor="var(--destructive)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--destructive)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Look here first: many reports, arriving fast. */}
      <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} fill={`url(#${HOT_QUADRANT_TINT})`} />

      <line
        x1={plot.x}
        y1={plot.y + plot.h}
        x2={plot.x + plot.w}
        y2={plot.y + plot.h}
        stroke="var(--border)"
      />
      <line x1={plot.x} y1={plot.y} x2={plot.x} y2={plot.y + plot.h} stroke="var(--border)" />

      <text
        x={plot.x}
        y={plot.y - 10}
        className="fill-muted-foreground text-[13px] font-semibold"
      >
        ↑ more reports
      </text>
      <text
        x={plot.x + plot.w}
        y={plot.y + plot.h + 30}
        textAnchor="end"
        className="fill-muted-foreground text-[13px] font-semibold"
      >
        arriving faster →
      </text>

      {placed.map(({ group, cx, cy, r, fill }) => {
        const selected = group.id === selectedSignalId;
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
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={fill}
              fillOpacity={selected ? 0.5 : 0.28}
              stroke={fill}
              strokeWidth={selected ? 3 : 1.5}
            />
            {(group.memberCount >= LABEL_FROM_REPORTS || selected) && (
              <>
                <text
                  x={cx}
                  y={cy + r + 16}
                  textAnchor="middle"
                  className={cn(
                    "fill-foreground text-[13px]",
                    selected ? "font-bold" : "font-semibold",
                  )}
                >
                  {localityOf(group.label)}
                </text>
                <text
                  x={cx}
                  y={cy + r + 31}
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
  );
}
