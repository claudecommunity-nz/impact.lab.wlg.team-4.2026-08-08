import { INFO_CREDIBILITY_LABELS, type Grade } from "@/db/vocabulary";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The one place the board turns an Admiralty grade into words and a colour.
 *
 * Two audiences, one grade. On the map and the cards it reads in plain English
 * — "corroborated", "unclear" — because the first question anyone asks is
 * whether to believe it, and "C3" answers that only for someone who already
 * knows the Admiralty system. The letters are not dropped: they stay in the
 * drill panel, where an operator has chosen to look at the expert layer.
 *
 * Colour is drawn from the theme tokens, never hardcoded, so both themes and
 * any future palette change stay consistent: sage = corroborated, amber =
 * unclear, terracotta = doubtful, muted = cannot be judged. Grey for "truth
 * cannot be judged" is deliberate — that is an absence of assessment, not a
 * severity, and colouring it red would claim we know something bad.
 */
export type CredibilityTone = "confirmed" | "plausible" | "unclear" | "doubtful" | "unjudged";

export function credibilityTone(grade: Grade | null): CredibilityTone {
  if (!grade) return "unjudged";
  if (grade.infoCredibility === 1) return "confirmed";
  if (grade.infoCredibility <= 3) return "plausible";
  if (grade.infoCredibility === 4) return "unclear";
  if (grade.infoCredibility === 5) return "doubtful";
  return "unjudged";
}

/** What a non-specialist should read off the surface. */
export const PLAIN_CREDIBILITY: Record<CredibilityTone, string> = {
  confirmed: "confirmed",
  plausible: "corroborated",
  unclear: "unclear",
  doubtful: "doubtful",
  unjudged: "can't judge yet",
};

export function plainCredibility(grade: Grade | null): string {
  return PLAIN_CREDIBILITY[credibilityTone(grade)];
}

/** A CSS colour for non-React surfaces (MapLibre markers are plain DOM). */
const TONE_COLOUR: Record<CredibilityTone, string> = {
  confirmed: "var(--primary)",
  plausible: "var(--primary)",
  unclear: "var(--warning)",
  doubtful: "var(--destructive)",
  unjudged: "var(--muted-foreground)",
};

export function credibilityColour(grade: Grade | null): string {
  return TONE_COLOUR[credibilityTone(grade)];
}

/** "C3" — the two axes, unblended. Expert layer only. */
export function gradeCode(grade: Grade | null): string {
  return grade ? `${grade.sourceReliability}${grade.infoCredibility}` : "—";
}

/** The full Admiralty sentence. Prefer the API's own label. */
export function gradeSentence(grade: Grade | null): string {
  if (!grade) return "not yet graded";
  if (grade.label) return grade.label;
  return INFO_CREDIBILITY_LABELS[grade.infoCredibility] ?? "unknown credibility";
}

const TONE_CLASS: Record<CredibilityTone, string> = {
  confirmed: "border-primary/30 bg-primary/10 text-primary",
  plausible: "border-primary/30 bg-primary/10 text-primary",
  unclear: "border-warning/40 bg-warning/10 text-warning-foreground dark:text-warning",
  doubtful: "border-destructive/30 bg-destructive/10 text-destructive",
  unjudged: "border-border bg-muted text-muted-foreground",
};

/**
 * The credibility chip. Plain English by default; `showCode` adds the Admiralty
 * letters for the drill panel.
 */
export function CredibilityChip({
  grade,
  showCode = false,
  className,
}: {
  grade: Grade | null;
  showCode?: boolean;
  className?: string;
}) {
  const tone = credibilityTone(grade);

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 rounded-full font-medium", TONE_CLASS[tone], className)}
      title={gradeSentence(grade)}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: TONE_COLOUR[tone], opacity: grade ? 1 : 0.6 }}
      />
      {PLAIN_CREDIBILITY[tone]}
      {showCode && <span className="font-mono text-[10px] opacity-70">{gradeCode(grade)}</span>}
    </Badge>
  );
}

/**
 * The legend, one line tall. A colour ramp nobody can read invents its own
 * meaning in the viewer's head — but the words here are the same words the
 * chips wear, so a dot and a word each is the whole key. The longer
 * explanations ride on hover, where they cost no pixels.
 */
export function CredibilityLegend({ className }: { className?: string }) {
  const rows: { tone: CredibilityTone; hint: string }[] = [
    { tone: "plausible", hint: "more than one independent source" },
    { tone: "unclear", hint: "only one origin so far" },
    { tone: "doubtful", hint: "something contradicts it" },
    { tone: "unjudged", hint: "not enough to say" },
  ];

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {rows.map((row) => (
        <span
          key={row.tone}
          title={row.hint}
          className="flex items-center gap-1.5 text-[11px] font-medium"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: TONE_COLOUR[row.tone] }}
          />
          {PLAIN_CREDIBILITY[row.tone]}
        </span>
      ))}
    </div>
  );
}

/**
 * snake_case is a database detail. It should never reach a judge, an operator,
 * or anyone else who did not write the schema.
 */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Cluster labels arrive as "dam_failure — Karori Road". Humanise the hazard
 * half and leave the place name exactly as the pipeline wrote it.
 */
export function humanizeLabel(label: string | null): string {
  if (!label) return "Unnamed signal";
  return humanize(label);
}

/**
 * A pill-sized name for the map.
 *
 * Labels arrive in two shapes: our pipeline's "flooding — Aro Valley", and
 * reverse-geocoded addresses from collectors ("Magnolia Grove, Maungaraki,
 * Lower Hutt, Wellington, 5010"). Both have to fit in a pill an operator reads
 * at a glance while scanning a city, so this takes the place half, then the
 * most specific part of an address, and caps what is left. The full label is
 * still on the marker's accessible name and in the drill panel.
 */
const MAX_PILL_CHARS = 24;

export function localityOf(label: string | null): string {
  if (!label) return "Unnamed";

  const [, afterHazard] = label.split(/\s+—\s+/);
  const place = (afterHazard ?? label).split(",")[0].trim();
  const named = humanize(place);

  return named.length > MAX_PILL_CHARS ? `${named.slice(0, MAX_PILL_CHARS - 1)}…` : named;
}

/**
 * A label short enough to sit under a bubble without colliding with its
 * neighbours.
 *
 * Reverse-geocoded labels arrive as "Unclassified — Queens Drive, Hutt Central,
 * Lower Hutt, Wellington, 5010". Almost all of that is noise at a glance: the
 * street and the suburb identify it, the postcode never does. "unclassified"
 * says nothing either, so those lead with the place alone.
 */
export function bubbleLabel(label: string | null): string {
  if (!label) return "Unnamed";

  const [first, rest] = label.split(/\s+—\s+/);
  const hazard = rest ? first : null;
  const place = (rest ?? first)
    .split(",")
    .slice(0, 2)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");

  if (!hazard || hazard.toLowerCase() === "unclassified") return humanize(place);
  return `${humanize(hazard)} — ${place.split(",")[0]}`;
}
