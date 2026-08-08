import { INFO_CREDIBILITY_LABELS, type Grade } from "@/db/vocabulary";
import { cn } from "@/lib/utils";

/**
 * The one place the board turns an Admiralty grade into a colour and a chip.
 *
 * Shared by the map, the galaxy and the drill panel so a signal cannot describe
 * itself in three different colours. `db/vocabulary` is the source of the words
 * (it has no runtime dependency beyond zod, so any layer may import it) — this
 * file only adds the pixels.
 *
 * The ramp deliberately runs blue → violet → amber → rose → GREY, and grey is
 * the end of it: "truth cannot be judged" is an absence of assessment, not a
 * severity, and colouring it red would tell an operator something we have not
 * earned the right to say. None of these hues is the teal interaction accent —
 * a signal's credibility must never look like something you can click.
 *
 * Credibility 1 ("confirmed by other sources") is unreachable by code and only
 * ever set by a human, so its green appears exactly when a person has signed
 * their name to it (`confirmedBy`).
 */
export const CREDIBILITY_COLOURS: Record<number, string> = {
  1: "#4ade80",
  2: "#60a5fa",
  3: "#a78bfa",
  4: "#fbbf24",
  5: "#fb7185",
  6: "#94a3b8",
};

/** Not yet graded is its own state — never the middle of the ramp. */
export const UNGRADED_COLOUR = "#64748b";

export function credibilityColour(grade: Grade | null): string {
  if (!grade) return UNGRADED_COLOUR;
  return CREDIBILITY_COLOURS[grade.infoCredibility] ?? UNGRADED_COLOUR;
}

/** "C3" — the two axes, unblended, in the smallest space that stays honest. */
export function gradeCode(grade: Grade | null): string {
  return grade ? `${grade.sourceReliability}${grade.infoCredibility}` : "—";
}

/** The full sentence. Prefer the API's own label; fall back to our vocabulary. */
export function gradeSentence(grade: Grade | null): string {
  if (!grade) return "not yet graded";
  if (grade.label) return grade.label;
  return INFO_CREDIBILITY_LABELS[grade.infoCredibility] ?? "unknown credibility";
}

/**
 * The grade as a chip. `tone="solid"` for the map (it sits on a basemap and has
 * to win); `tone="quiet"` inside panels where the surrounding text carries it.
 */
export function GradeChip({
  grade,
  tone = "quiet",
  className,
}: {
  grade: Grade | null;
  tone?: "solid" | "quiet";
  className?: string;
}) {
  const colour = credibilityColour(grade);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] leading-none font-semibold tracking-wider tabular-nums",
        className,
      )}
      style={{
        color: colour,
        borderColor: `color-mix(in oklab, ${colour} 45%, transparent)`,
        background:
          tone === "solid"
            ? `color-mix(in oklab, ${colour} 16%, #0b1017)`
            : `color-mix(in oklab, ${colour} 12%, transparent)`,
      }}
      title={gradeSentence(grade)}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: colour, opacity: grade ? 1 : 0.5 }}
      />
      {gradeCode(grade)}
    </span>
  );
}

/**
 * The legend. Shown on the map because a colour ramp nobody can read is a ramp
 * that invents its own meaning in the viewer's head.
 */
export function CredibilityLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p className="text-muted-foreground/70 font-mono text-[10px] tracking-[0.12em] uppercase">
        Info credibility
      </p>
      <ul className="flex flex-col gap-0.5">
        {[2, 3, 4, 5, 6].map((level) => (
          <li key={level} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: CREDIBILITY_COLOURS[level] }}
            />
            <span className="text-muted-foreground font-mono text-[10px]">
              {level} · {INFO_CREDIBILITY_LABELS[level]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
