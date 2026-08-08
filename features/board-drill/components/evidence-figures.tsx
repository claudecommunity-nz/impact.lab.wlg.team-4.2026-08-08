/**
 * The two numbers that decide whether a duty officer acts, shown side by side
 * and never blended.
 *
 * `independentSources` is distinct ORIGINS; `itemCount` is how many times we
 * saw it. Printing only the second is the single most misleading thing this
 * interface could do — "seven reports" of one screenshot is one observation —
 * so they are always drawn together, and when they disagree the panel says in
 * words which way the gap runs.
 */
export function EvidenceFigures({
  independentSources,
  itemCount,
  originGroupCount,
}: {
  independentSources: number;
  itemCount: number;
  originGroupCount: number;
}) {
  const amplified = itemCount > independentSources;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Figure
          value={independentSources}
          label="Independent sources"
          hint="Distinct origins behind this signal"
          emphasis
        />
        <Figure value={itemCount} label="Items" hint="Individual posts, reports or readings" />
      </div>

      {amplified && (
        <p className="text-muted-foreground rounded-md border border-dashed px-2.5 py-2 text-[11.5px] leading-relaxed">
          <span className="font-semibold" style={{ color: "#fbbf24" }}>
            Amplification:{" "}
          </span>
          {itemCount} items trace back to {originGroupCount}{" "}
          {originGroupCount === 1 ? "distinct observation" : "distinct observations"}. Repeats
          and quotes of the same post are not extra corroboration.
        </p>
      )}
    </div>
  );
}

function Figure({
  value,
  label,
  hint,
  emphasis,
}: {
  value: number;
  label: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <div className="bg-muted border-border rounded-md border p-2.5">
      <p
        className="font-mono text-2xl leading-none font-semibold tabular-nums"
        style={emphasis ? { color: "#5eead4" } : undefined}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-semibold">{label}</p>
      <p className="text-muted-foreground/80 mt-0.5 text-[10px] leading-snug">{hint}</p>
    </div>
  );
}
