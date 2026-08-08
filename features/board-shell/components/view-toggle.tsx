"use client";

export type BoardView = "map" | "galaxy";

const VIEWS: { id: BoardView; label: string; hint: string }[] = [
  { id: "map", label: "Map", hint: "Geographic — authoritative for place" },
  { id: "galaxy", label: "Galaxy", hint: "Semantic — clusters by what was said" },
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
      className="board-line flex overflow-hidden rounded-lg border"
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
            className={
              active
                ? "board-toggle board-accent px-3.5 py-1.5 text-[11.5px] font-semibold"
                : "board-toggle board-panel board-muted px-3.5 py-1.5 text-[11.5px] font-semibold"
            }
            style={active ? { background: "var(--board-accent-dim)" } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
