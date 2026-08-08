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
    <li className="border-border border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="bg-muted border-border rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold">
          {entry.source}
        </span>
        <span className="text-muted-foreground/80 font-mono text-[10px]">{entry.sourceClass}</span>
        {entry.author && <span className="text-muted-foreground/80 font-mono text-[10px]">{entry.author}</span>}
        <span className="flex-1" />
        <time
          dateTime={entry.occurredAt.toISOString()}
          className="text-muted-foreground font-mono text-[10px] tabular-nums"
          title={`Captured ${format(entry.ingestedAt, "d MMM HH:mm:ss")}`}
        >
          {format(entry.occurredAt, "d MMM HH:mm")}
        </time>
      </div>

      <blockquote className="mt-2 border-l-2 pl-2.5 text-[12.5px] leading-relaxed">
        {entry.excerpt}
      </blockquote>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {amplifiedOrigin && (
          <span className="text-muted-foreground/80 border-border rounded border px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.08em]">
            SAME ORIGIN AS ANOTHER ITEM
          </span>
        )}
        {entry.quotedUrls.length > 0 && (
          <span className="text-muted-foreground/80 border-border rounded border px-1.5 py-0.5 font-mono text-[9.5px]">
            quotes {entry.quotedUrls.length}{" "}
            {entry.quotedUrls.length === 1 ? "link" : "links"}
          </span>
        )}
        {entry.lat === null && (
          <span className="text-muted-foreground/80 border-border rounded border px-1.5 py-0.5 font-mono text-[9.5px]">
            no coordinates
          </span>
        )}
      </div>

      <p className="text-muted-foreground/80 mt-2 font-mono text-[10px] leading-relaxed">
        ↳ matched: {entry.membershipReason}
      </p>
    </li>
  );
}
