/**
 * Standing chrome: the two things on this screen that are true before any data
 * arrives, so both the skeleton and the live board render them identically.
 */

export function BoardBrand() {
  return (
    <div className="flex items-baseline gap-2">
      <h1 className="text-sm font-bold tracking-[0.02em]">SIGNAL BOARD</h1>
      <p className="board-faint text-[11px] font-medium">
        Wellington · emerging impacts from public information
      </p>
    </div>
  );
}

/**
 * The caveat is chrome, not a dismissible toast, because it is never not true:
 * everything on this board is unverified public information, and the problem
 * statement is explicitly about making that limitation visible.
 */
export function BoardBanner() {
  return (
    <p
      className="rounded-full border px-2.5 py-[3px] font-mono text-[10px] tracking-[0.08em]"
      style={{
        color: "#fbbf24",
        borderColor: "rgba(251,191,36,.35)",
        background: "rgba(251,191,36,.08)",
      }}
    >
      UNVERIFIED · FOR INVESTIGATION · NOT AN OPERATIONAL SOURCE — IN AN EMERGENCY CALL 111
    </p>
  );
}
