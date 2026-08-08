import { format } from "date-fns";
import type { ProvenanceEntry } from "@/components/board/api-types";

/**
 * One piece of evidence, shown the way an intelligence team needs to judge it:
 * who published it, when, in their own words, and why we put it in this cluster.
 *
 * The excerpt is verbatim and never summarised — a paraphrase of an unverified
 * post is a second unverified claim. `synthetic` is carried onto every entry
 * that has it, because a drill item must be impossible to mistake for a real
 * report no matter how deep somebody has drilled.
 */
export function ProvenanceItem({
  entry,
  amplifiedOrigin,
}: {
  entry: ProvenanceEntry;
  /** True when other items in this cluster trace to the same observation. */
  amplifiedOrigin: boolean;
}) {
  return (
    <li className="board-line border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="board-panel-2 board-line rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          {entry.source}
        </span>
        <span className="board-faint font-mono text-[10px]">{entry.sourceClass}</span>
        {entry.author && <span className="board-faint font-mono text-[10px]">{entry.author}</span>}
        <span className="flex-1" />
        <time
          dateTime={entry.occurredAt.toISOString()}
          className="board-muted font-mono text-[10px] tabular-nums"
          title={`Captured ${format(entry.ingestedAt, "d MMM HH:mm:ss")}`}
        >
          {format(entry.occurredAt, "d MMM HH:mm")}
        </time>
      </div>

      <blockquote className="mt-2 border-l-2 pl-2.5 text-[12.5px] leading-relaxed">
        {entry.excerpt}
      </blockquote>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {entry.synthetic && (
          <span
            className="rounded border border-dashed px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em]"
            style={{ color: "#fbbf24", borderColor: "rgba(251,191,36,.4)" }}
          >
            SYNTHETIC — authored for a demo or drill
          </span>
        )}
        {amplifiedOrigin && (
          <span className="board-faint board-line rounded border px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em]">
            SAME ORIGIN AS ANOTHER ITEM
          </span>
        )}
        {entry.quotedUrls.length > 0 && (
          <span className="board-faint board-line rounded border px-1.5 py-0.5 font-mono text-[9.5px]">
            quotes {entry.quotedUrls.length}{" "}
            {entry.quotedUrls.length === 1 ? "link" : "links"}
          </span>
        )}
        {entry.lat === null && (
          <span className="board-faint board-line rounded border px-1.5 py-0.5 font-mono text-[9.5px]">
            no coordinates
          </span>
        )}
      </div>

      <p className="board-faint mt-2 font-mono text-[10px] leading-relaxed">
        ↳ matched: {entry.membershipReason}
      </p>
    </li>
  );
}
