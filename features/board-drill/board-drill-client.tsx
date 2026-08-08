"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { X } from "lucide-react";
import type { SignalDetail } from "@/components/board/api-types";
import { CredibilityChip, gradeSentence, humanize, humanizeLabel } from "@/components/board/grade";
import { FeatureError } from "@/components/errors/feature-error";
import { useTRPC } from "@/trpc/client";
import { BoardDrillSkeleton } from "./board-drill-skeleton";
import { CollapsedOrigins } from "./components/collapsed-origins";
import { EvidenceFigures } from "./components/evidence-figures";
import { ProvenanceItem } from "./components/provenance-item";

const POLL_MS = 5000;

/**
 * The walk from a coloured dot back to the words somebody actually published.
 *
 * This panel is the whole argument of the prototype: a marker saying "probably
 * true" is worth nothing to an intelligence team unless they can open it and
 * judge the evidence for themselves. So everything here is evidence or an
 * explanation of evidence, in this order — what we think, WHY we think it, how
 * much of it is genuinely independent, and then every original post.
 *
 * It has no -server half deliberately: the id only exists once an operator has
 * clicked something, so there is nothing a request-time prefetch could fetch.
 */
export function BoardDrillClient({
  signalId,
  onClose,
}: {
  signalId: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const detail = useQuery(
    trpc.signals.detail.queryOptions({ signalId }, { refetchInterval: POLL_MS }),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-border flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground/80 font-mono text-[10px] tracking-[0.12em] uppercase">
            Signal · {signalId.slice(0, 8)}
          </p>
          <h2 className="mt-0.5 truncate text-sm font-semibold">
            {humanizeLabel(detail.data?.label ?? null)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close signal detail"
          className="border-border text-muted-foreground rounded-md border p-1.5"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>

      {detail.isError ? (
        <FeatureError name="this signal's evidence" />
      ) : !detail.data ? (
        <BoardDrillSkeleton />
      ) : (
        <DrillBody detail={detail.data} />
      )}
    </div>
  );
}

function DrillBody({ detail }: { detail: SignalDetail }) {
  // originId → how many items trace to it. Anything above one is amplification,
  // not corroboration, and every entry from that origin is marked as such.
  const originSize = new Map(
    detail.originGroups.map((group) => [group.originId, group.itemIds.length]),
  );

  // The alert feed is a separate read this panel does not make — but the same
  // sentences ride along on the grade events it already has, so the newest
  // firing transition tells us why this was raised, with no extra query.
  const latestAlertReasons =
    [...detail.gradeHistory].reverse().find((event) => event.alertFired)?.alertReasons ?? [];

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CredibilityChip grade={detail.grade} showCode />
          <span className="text-muted-foreground text-[11.5px]">{gradeSentence(detail.grade)}</span>
        </div>
        {detail.confirmedBy && (
          <p className="text-muted-foreground text-[11px]">
            Confirmed by <span className="font-semibold">{detail.confirmedBy}</span> — the only
            way credibility 1 is ever reached.
          </p>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
          Why it is graded this way
        </h3>
        {detail.reasons.length === 0 ? (
          <p className="text-muted-foreground/80 text-[11.5px]">
            No reasons published yet — this signal has not been graded.
          </p>
        ) : (
          <ol className="space-y-1">
            {detail.reasons.map((reason, index) => (
              <li key={reason} className="flex gap-2 text-[11.5px] leading-relaxed">
                <span className="text-muted-foreground/80 font-mono tabular-nums">{index + 1}.</span>
                <span>{reason}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <EvidenceFigures
        independentSources={detail.independentSources}
        itemCount={detail.itemCount}
        originGroupCount={detail.originGroups.length}
      />

      <CollapsedOrigins originGroups={detail.originGroups} />

      <section className="bg-muted border-border grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border p-2.5 font-mono text-[10.5px]">
        <Fact label="Issue type" value={humanize(detail.issueType)} />
        <Fact label="Location" value={detail.locationCertainty} />
        <Fact label="Dataset" value={detail.datasetId} />
        <Fact label="Source classes" value={detail.sourceClasses.join(", ") || "—"} />
        <Fact label="Alert-worthy" value={detail.alertWorthy ? "yes" : "no"} />
        <Fact label="First seen" value={format(detail.firstSeen, "d MMM HH:mm")} />
        <Fact label="Last seen" value={format(detail.lastSeen, "d MMM HH:mm")} />
      </section>

      {latestAlertReasons.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
            Why it is worth someone&apos;s attention
          </h3>
          {/* Alert-worthiness is computed INDEPENDENTLY of the grade, so an
              early single-source report can raise a flag WITH its weakness
              stated rather than being silenced by a threshold in exactly the
              hour it matters most. Printing only "Alert-worthy: yes" would hide
              the half of that sentence which does the work. */}
          <ul className="space-y-1">
            {latestAlertReasons.map((reason) => (
              <li
                key={reason}
                className="text-[11.5px] leading-relaxed"
                style={reason.startsWith("WEAK EVIDENCE") ? { color: "#fbbf24" } : undefined}
              >
                {reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
          Provenance · {detail.provenance.length}{" "}
          {detail.provenance.length === 1 ? "item" : "items"}
        </h3>
        <ul>
          {detail.provenance.map((entry) => (
            <ProvenanceItem
              key={entry.itemId}
              entry={entry}
              amplifiedOrigin={(originSize.get(entry.originId) ?? 1) > 1}
            />
          ))}
        </ul>
      </section>

      {detail.gradeHistory.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
            How the assessment moved
          </h3>
          <ol className="space-y-1.5">
            {detail.gradeHistory.map((event) => (
              <li
                key={event.at.toISOString()}
                className="flex items-center gap-2 font-mono text-[10.5px]"
              >
                <time className="text-muted-foreground/80 tabular-nums" dateTime={event.at.toISOString()}>
                  {format(event.at, "d MMM HH:mm")}
                </time>
                {event.fromGrade && <CredibilityChip grade={event.fromGrade} showCode />}
                {event.fromGrade && <span className="text-muted-foreground/80">→</span>}
                <CredibilityChip grade={event.toGrade} showCode />
                <span className="text-muted-foreground/80">
                  {event.independentSources}src / {event.itemCount}it
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground/80 text-[9.5px] tracking-[0.08em] uppercase">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  );
}
