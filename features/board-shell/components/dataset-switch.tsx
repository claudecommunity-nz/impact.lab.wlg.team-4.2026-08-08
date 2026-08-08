import Link from "next/link";

const DATASETS = [
  { id: "live", label: "Live", hint: "The operational picture" },
  { id: "demo", label: "Demo", hint: "Synthetic fixture — fabricated corroboration" },
];

/**
 * Which namespace the board is drawing.
 *
 * Clustering never crosses datasets, so this is not a filter — it is a choice of
 * which world you are looking at, and the board must never leave that ambiguous.
 * A dataset outside the known two (a replay, another team's fixture) still shows
 * its own name rather than falling back to a wrong highlight.
 */
export function DatasetSwitch({ datasetId }: { datasetId: string }) {
  const known = DATASETS.some((dataset) => dataset.id === datasetId);

  return (
    <div className="flex items-center gap-1.5">
      <span className="board-faint font-mono text-[9.5px] tracking-[0.12em] uppercase">
        Dataset
      </span>
      <div className="board-line flex overflow-hidden rounded-lg border">
        {DATASETS.map((dataset) => {
          const active = dataset.id === datasetId;
          return (
            <Link
              key={dataset.id}
              href={`/board?dataset=${dataset.id}`}
              title={dataset.hint}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "board-toggle board-accent px-2.5 py-1 font-mono text-[10.5px] font-semibold"
                  : "board-toggle board-panel board-muted px-2.5 py-1 font-mono text-[10.5px] font-semibold"
              }
              style={active ? { background: "var(--board-accent-dim)" } : undefined}
            >
              {dataset.label}
            </Link>
          );
        })}
        {!known && (
          <span className="board-accent px-2.5 py-1 font-mono text-[10.5px] font-semibold">
            {datasetId}
          </span>
        )}
      </div>
    </div>
  );
}
