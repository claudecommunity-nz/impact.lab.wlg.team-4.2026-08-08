"use client";

import { useQuery } from "@tanstack/react-query";
import type { SignalProperties } from "@/components/board/api-types";
import { BOARD_DATASET } from "@/features/board-shell/board-dataset";
import { useTRPC } from "@/trpc/client";
import { BoardLanesSkeleton } from "./board-lanes-skeleton";
import { AgreementRail } from "./components/agreement-rail";
import { VelocityCard } from "./components/velocity-card";

const POLL_MS = 3000;
const VELOCITY_CARDS = 3;
const AGREEMENT_ROWS = 2;
/** One report is not yet a story; a lane of singletons says nothing. */
const MIN_REPORTS = 2;

/**
 * The two lanes above the map: what is growing, and what is most reported.
 *
 * They answer the question a map cannot. A map shows where things are; it
 * cannot show that one of them arrived in the last twenty minutes and another
 * has been sitting there since yesterday. That is the difference between a
 * picture and a triage tool.
 *
 * Velocity comes from `vectors.groups` and grades from `signals.geojson`, and
 * they are joined on the cluster id — the same id the map's markers and the
 * drill panel use, so clicking a card selects exactly the marker underneath.
 * Both queries share their keys with the panes below, so this costs no extra
 * request per poll.
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
    .slice(0, VELOCITY_CARDS);

  const reported = [...properties]
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, AGREEMENT_ROWS);

  if (growing.length === 0 && reported.length === 0) return null;

  const hottest = Math.max(...growing.map((s) => perHour.get(s.signalId) ?? 0), 1);

  return (
    <div className="border-border bg-background flex shrink-0 flex-col gap-4 border-b px-4 py-3 lg:flex-row">
      {growing.length > 0 && (
        <section className="min-w-0 flex-1">
          <h2 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.1em] uppercase">
            Picking up speed
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            {growing.map((signal) => (
              <VelocityCard
                key={signal.signalId}
                signal={signal}
                perHour={perHour.get(signal.signalId) ?? 0}
                hottest={hottest}
                selected={signal.signalId === selectedSignalId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}

      {reported.length > 0 && (
        <section className="min-w-0">
          <h2 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-[0.1em] uppercase">
            Most talked about
          </h2>
          <AgreementRail
            signals={reported}
            selectedSignalId={selectedSignalId}
            onSelect={onSelect}
          />
        </section>
      )}
    </div>
  );
}
