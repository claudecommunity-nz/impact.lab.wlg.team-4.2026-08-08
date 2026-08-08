"use client";

import { useQuery } from "@tanstack/react-query";
import type { SignalProperties } from "@/components/board/api-types";
import { BOARD_DATASET } from "@/features/board-shell/board-dataset";
import { useTRPC } from "@/trpc/client";
import { BoardLanesSkeleton } from "./board-lanes-skeleton";
import { AgreementPill, VelocityPill } from "./components/signal-pill";

const POLL_MS = 3000;
const VELOCITY_PILLS = 4;
const AGREEMENT_PILLS = 3;
/** One report is not yet a story; a ticker of singletons says nothing. */
const MIN_REPORTS = 2;

/**
 * The ticker above the map: what is growing, and what is most reported, as one
 * strip of pills instead of a band of cards. The map is the exhibit; this row
 * ranks it, and a ranking does not need a third of the screen to be read.
 *
 * It still answers the question a map cannot. A map shows where things are; it
 * cannot show that one of them arrived in the last twenty minutes and another
 * has been sitting there since yesterday. That is the difference between a
 * picture and a triage tool.
 *
 * Velocity comes from `vectors.groups` and grades from `signals.geojson`, and
 * they are joined on the cluster id — the same id the map's markers and the
 * drill panel use, so clicking a pill selects exactly the marker underneath.
 * Both queries share their keys with the panes below, so this costs no extra
 * request per poll. Overflow scrolls sideways rather than wrapping: the strip
 * buys the map its height back, and must not give it up on a busy day.
 */
export function BoardLanesClient({
  selectedSignalId,
  onSelect,
}: {
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const trpc = useTRPC();

  const signals = useQuery(
    trpc.signals.geojson.queryOptions(
      { datasetId: BOARD_DATASET },
      { refetchInterval: POLL_MS },
    ),
  );
  const groups = useQuery(
    trpc.vectors.groups.queryOptions({ datasetId: BOARD_DATASET }, { refetchInterval: POLL_MS }),
  );

  if (!signals.data || !groups.data) return <BoardLanesSkeleton />;

  const perHour = new Map(groups.data.map((group) => [group.id, group.velocity]));
  const properties: SignalProperties[] = signals.data.features
    .map((feature) => feature.properties)
    .filter((signal) => signal.itemCount >= MIN_REPORTS);

  const growing = [...properties]
    .filter((signal) => (perHour.get(signal.signalId) ?? 0) > 0)
    .sort((a, b) => (perHour.get(b.signalId) ?? 0) - (perHour.get(a.signalId) ?? 0))
    .slice(0, VELOCITY_PILLS);

  // In separate lanes a story could appear in both; in one row a repeated
  // label reads as a bug, and the growing pill is the more urgent framing.
  const growingIds = new Set(growing.map((signal) => signal.signalId));
  const reported = properties
    .filter((signal) => !growingIds.has(signal.signalId))
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, AGREEMENT_PILLS);

  if (growing.length === 0 && reported.length === 0) return null;

  return (
    <div className="border-border bg-background flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b px-4 [scrollbar-width:thin]">
      {growing.length > 0 && (
        <>
          <h2 className="text-muted-foreground shrink-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            Picking up speed
          </h2>
          {growing.map((signal) => (
            <VelocityPill
              key={signal.signalId}
              signal={signal}
              perHour={perHour.get(signal.signalId) ?? 0}
              selected={signal.signalId === selectedSignalId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {growing.length > 0 && reported.length > 0 && (
        <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
      )}

      {reported.length > 0 && (
        <>
          <h2 className="text-muted-foreground shrink-0 text-[10.5px] font-semibold tracking-[0.1em] uppercase">
            Most talked about
          </h2>
          {reported.map((signal) => (
            <AgreementPill
              key={signal.signalId}
              signal={signal}
              selected={signal.signalId === selectedSignalId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}
