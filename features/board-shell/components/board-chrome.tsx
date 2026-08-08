/**
 * Standing chrome: the two things on this screen that are true before any data
 * arrives, so both the skeleton and the live board render them identically.
 */

export function BoardBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="bg-primary size-2.5 shrink-0 rounded-full"
      />
      <div className="flex items-baseline gap-2">
        <h1 className="font-heading text-[15px] font-bold tracking-[-0.02em]">Signal Board</h1>
        <p className="text-muted-foreground hidden text-[13px] sm:block">Wellington</p>
      </div>
    </div>
  );
}

/**
 * The caveat is chrome, not a dismissible toast, because it is never not true:
 * everything on this board is unverified public information, and the problem
 * statement is explicitly about making that limitation visible.
 *
 * Written the way a person would say it. "Nothing here is confirmed" lands on
 * someone who has never heard of the Admiralty system; "unverified signals
 * pending corroboration" does not.
 */
export function BoardBanner() {
  return (
    <p className="border-warning/40 bg-warning/10 text-foreground flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium">
      <span aria-hidden className="bg-warning size-2 shrink-0 rounded-full" />
      Nothing here is confirmed — these are things to check. In an emergency call 111.
    </p>
  );
}
