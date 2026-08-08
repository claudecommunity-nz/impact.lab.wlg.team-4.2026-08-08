"use client";

import { cn } from "@/lib/utils";

export type BoardView = "map" | "galaxy";

const VIEWS: { id: BoardView; label: string; hint: string }[] = [
  { id: "map", label: "Map", hint: "Where reports are coming from" },
  { id: "galaxy", label: "Galaxy", hint: "What reports are saying, grouped by meaning" },
];

/**
 * Two views of the same signals. Presentational: props in, callback out.
 *
 * A radiogroup rather than two buttons, because these are one exclusive choice
 * and a keyboard user should be able to arrow between them.
 */
export function ViewToggle({
  view,
  onChange,
}: {
  view: BoardView;
  onChange: (view: BoardView) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Visualisation"
      className="bg-muted border-border flex items-center gap-0.5 rounded-full border p-0.5"
    >
      {VIEWS.map((option) => {
        const active = option.id === view;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={cn(
              "focus-visible:ring-ring rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
