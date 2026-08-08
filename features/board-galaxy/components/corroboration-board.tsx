"use client";

import type { SignalProperties } from "@/components/board/api-types";
import { CredibilityChip, bubbleLabel, humanize } from "@/components/board/grade";
import { cn } from "@/lib/utils";

/**
 * The trends view: the problem statement, laid out as a screen.
 *
 * The brief asks for exactly three things this view must communicate: where
 * impacts may be EMERGING, where several INDEPENDENT sources appear to
 * describe the same event, and that none of it is verified fact. So the view
 * is titled in the brief's own words — matters needing confirmation — the
 * fastest-arriving story is a hero card whose centrepiece is its independence
 * meter (one cell per report, filled cells are separate voices), and the
 * stance line sits in the header, not a footnote.
 *
 * Layout is a main column and a rail: the main column is the worklist
 * (growing stories, hottest first, emphasis shrinking down the queue); the
 * rail holds what is building, what has gone quiet, and the honest note about
 * the singletons this view refuses to rank. One screen, no axes to decode.
 *
 * Time runs on the board's own clock — the newest report anywhere in the feed
 * — not the wall clock, so a replayed demo and a live feed band identically.
 * `velocity` alone cannot say "growing right now": it counts reports in the
 * hour before the story's OWN last report, so it never decays. Recency is
 * what separates a surge from a story that surged and stopped.
 */

const HOUR_MS = 60 * 60 * 1000;
/** A cluster one person reported is not yet a story. */
const MIN_REPORTS = 2;
/** Nothing new for this long (board clock) = gone quiet. */
const QUIET_AFTER_MS = HOUR_MS;
/** At least this many inside the story's latest hour to call it moving. */
const MOVING_MIN_PER_HOUR = 2;

function ago(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hours} h ago` : `${hours} h ${rem} min ago`;
}

export function CorroborationBoard({
  signals,
  perHour,
  selectedSignalId,
  onSelect,
}: {
  signals: SignalProperties[];
  /** Cluster id → reports an hour, from the vector layer's cached fold. */
  perHour: Map<string, number>;
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const rateOf = (signal: SignalProperties) => perHour.get(signal.signalId) ?? 0;
  const seenOf = (signal: SignalProperties) => new Date(signal.lastSeen).getTime();

  // The board's "now": the newest report in the whole feed, singletons included
  // — the clock should not jump because a small story fell below the cut.
  const boardNow = Math.max(...signals.map(seenOf), 0);
  const ageOf = (signal: SignalProperties) => Math.max(0, boardNow - seenOf(signal));

  const stories = signals.filter((signal) => signal.itemCount >= MIN_REPORTS);
  const singles = signals.length - stories.length;

  const moving = stories
    .filter((s) => ageOf(s) <= QUIET_AFTER_MS && rateOf(s) >= MOVING_MIN_PER_HOUR)
    .sort((a, b) => rateOf(b) - rateOf(a) || b.itemCount - a.itemCount);
  const movingIds = new Set(moving.map((s) => s.signalId));
  const building = stories
    .filter((s) => ageOf(s) <= QUIET_AFTER_MS && !movingIds.has(s.signalId))
    .sort((a, b) => b.itemCount - a.itemCount);
  const quiet = stories
    .filter((s) => ageOf(s) > QUIET_AFTER_MS)
    .sort((a, b) => ageOf(a) - ageOf(b));

  if (stories.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 text-sm">
        <p>No cluster has more than one report yet.</p>
        {singles > 0 && (
          <p className="text-[12px]">
            {singles} single-report {singles === 1 ? "group" : "groups"} are on the map.
          </p>
        )}
      </div>
    );
  }

  const [lead, ...rest] = moving;

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5 p-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-heading text-[15px] font-bold tracking-[0.05em] uppercase">
          Matters needing confirmation
        </h2>
        <p className="text-muted-foreground text-[12px]">public reports, not verified facts</p>
        <div className="flex-1" />
        <p className="text-muted-foreground font-mono text-[11px] tabular-nums">
          {moving.length} growing · {building.length} building · {quiet.length} quiet
          {singles > 0 && ` · ${singles} single reports on the map`}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-w-0 flex-col gap-2.5">
          <BandHeading title="Needs eyes now" hint="several sources, still arriving" />

          {moving.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-[13px]">
              Nothing is growing right now.
            </p>
          )}

          {lead && (
            <LeadCard
              signal={lead}
              perHour={rateOf(lead)}
              age={ageOf(lead)}
              selected={lead.signalId === selectedSignalId}
              onSelect={onSelect}
            />
          )}

          {rest.map((signal) => (
            <MovingRow
              key={signal.signalId}
              signal={signal}
              perHour={rateOf(signal)}
              age={ageOf(signal)}
              selected={signal.signalId === selectedSignalId}
              onSelect={onSelect}
            />
          ))}
        </section>

        <aside className="flex min-w-0 flex-col gap-6">
          {building.length > 0 && (
            <section className="flex flex-col gap-2">
              <BandHeading title="Building" hint="recent, not growing right now" />
              {building.map((signal) => (
                <RailRow
                  key={signal.signalId}
                  signal={signal}
                  selected={signal.signalId === selectedSignalId}
                  onSelect={onSelect}
                  detail={`${signal.independentSources} of ${signal.itemCount} independent · ${ago(ageOf(signal))}`}
                />
              ))}
            </section>
          )}

          {quiet.length > 0 && (
            <section className="flex flex-col gap-2">
              <BandHeading title="Gone quiet" hint="nothing new in over an hour" />
              {quiet.map((signal) => (
                <RailRow
                  key={signal.signalId}
                  signal={signal}
                  muted
                  selected={signal.signalId === selectedSignalId}
                  onSelect={onSelect}
                  detail={`quiet ${ago(ageOf(signal)).replace(" ago", "")}`}
                />
              ))}
            </section>
          )}

          {singles > 0 && (
            <p className="text-muted-foreground text-[11.5px] leading-relaxed">
              {singles} single reports aren&apos;t ranked here — one voice isn&apos;t
              corroboration yet. Every one is still a pin on the map.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function BandHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <h3 className="text-[11px] font-semibold tracking-[0.1em] uppercase">
      {title} <span className="text-muted-foreground font-normal normal-case">— {hint}</span>
    </h3>
  );
}

/**
 * The brief's central question — do several INDEPENDENT sources describe the
 * same event? — drawn as a picture. One cell per report; a filled cell is a
 * separate voice, an empty one repeats something already counted. Past a
 * handful of dozen reports the cells would read as texture rather than a
 * count, so the meter goes continuous.
 */
const METER_MAX_CELLS = 24;

function IndependenceMeter({
  independent,
  total,
  className,
}: {
  independent: number;
  total: number;
  className?: string;
}) {
  if (total > METER_MAX_CELLS) {
    return (
      <div className={cn("bg-border h-2 overflow-hidden rounded-full", className)}>
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${Math.round((independent / Math.max(total, 1)) * 100)}%` }}
        />
      </div>
    );
  }
  return (
    <div className={cn("flex gap-[3px]", className)}>
      {Array.from({ length: total }, (_, cell) => (
        <span
          key={cell}
          className={cn(
            "h-2 min-w-0 flex-1 rounded-[2px]",
            cell < independent ? "bg-primary" : "bg-border",
          )}
        />
      ))}
    </div>
  );
}

/** "social · news · sensor", from the same vocabulary the drill panel uses. */
function sourceKinds(signal: SignalProperties): string {
  return signal.sourceClasses.map((kind) => humanize(kind).toLowerCase()).join(" · ");
}

/**
 * The fastest-arriving story gets the whole spec on one card: the rate, the
 * independence meter, the kinds of source behind it, and its limitation
 * (inferred location) stated rather than implied.
 */
function LeadCard({
  signal,
  perHour,
  age,
  selected,
  onSelect,
}: {
  signal: SignalProperties;
  perHour: number;
  age: number;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(signal.signalId)}
      className={cn(
        "border-destructive/35 bg-destructive/[0.04] focus-visible:ring-ring w-full cursor-pointer rounded-xl border-2 p-4 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none",
        selected && "ring-primary ring-2",
      )}
    >
      <div className="flex items-baseline gap-3">
        <span className="text-destructive flex shrink-0 items-center gap-2 font-mono text-[21px] font-semibold tabular-nums">
          <span aria-hidden className="bg-destructive size-2 rounded-full motion-safe:animate-pulse" />
          ▲ +{perHour}/h
        </span>
        <span className="font-heading min-w-0 flex-1 truncate text-[18px] font-bold">
          {bubbleLabel(signal.label)}
        </span>
        <CredibilityChip grade={signal.grade} className="shrink-0" />
      </div>

      <IndependenceMeter
        independent={signal.independentSources}
        total={signal.itemCount}
        className="mt-3.5"
      />
      <p className="mt-1.5 text-[12.5px]">
        <span className="font-mono font-semibold tabular-nums">
          {signal.independentSources} of {signal.itemCount}
        </span>{" "}
        <span className="text-muted-foreground">
          reports appear independent
          {signal.independentSources < signal.itemCount && " — the rest repeat each other"}
        </span>
      </p>

      <p className="text-muted-foreground mt-2.5 text-[12px]">
        {sourceKinds(signal)} — {signal.sourceClasses.length}{" "}
        {signal.sourceClasses.length === 1 ? "kind" : "kinds"} of source · last report{" "}
        {ago(age)}
        {signal.locationCertainty === "inferred" && " · location inferred, not stated"}
      </p>
    </button>
  );
}

function MovingRow({
  signal,
  perHour,
  age,
  selected,
  onSelect,
}: {
  signal: SignalProperties;
  perHour: number;
  age: number;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(signal.signalId)}
      className={cn(
        "border-border bg-card border-l-destructive/60 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-lg border border-l-[3px] px-3.5 py-2.5 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none",
        selected && "ring-primary ring-2",
      )}
    >
      <span className="text-destructive w-[58px] shrink-0 text-right font-mono text-[13.5px] font-semibold tabular-nums">
        ▲ +{perHour}/h
      </span>
      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
        {bubbleLabel(signal.label)}
      </span>
      <span className="hidden w-[132px] shrink-0 items-center gap-2 sm:flex">
        <IndependenceMeter
          independent={signal.independentSources}
          total={signal.itemCount}
          className="flex-1"
        />
        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
          {signal.independentSources}/{signal.itemCount}
        </span>
      </span>
      <span className="text-muted-foreground w-[48px] shrink-0 text-right font-mono text-[11px] tabular-nums">
        {ago(age).replace(" ago", "").replace("moments", "now")}
      </span>
      <CredibilityChip grade={signal.grade} className="shrink-0 text-[10.5px]" />
    </button>
  );
}

function RailRow({
  signal,
  detail,
  muted = false,
  selected,
  onSelect,
}: {
  signal: SignalProperties;
  detail: string;
  muted?: boolean;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(signal.signalId)}
      className={cn(
        "border-border bg-card focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:outline-none",
        muted && "opacity-65",
        selected && "ring-primary ring-2 opacity-100",
      )}
    >
      <span className="w-[26px] shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums">
        {signal.itemCount}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">
          {bubbleLabel(signal.label)}
        </span>
        <span className="text-muted-foreground block truncate text-[11px]">{detail}</span>
      </span>
    </button>
  );
}
