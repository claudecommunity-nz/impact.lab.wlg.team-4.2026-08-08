/**
 * Time-window resolution for every read. Pure — no IO.
 *
 * A window is anchored on the LATEST observation we hold, or now, whichever is
 * later. Not on the wall clock alone, and this is a deliberate decision:
 *
 *   - a replayed or seeded dataset (a demo, a backfill, a drill) is stamped
 *     with the times the events actually happened; anchoring on `now` would
 *     make an entire dataset invisible and look like a broken read;
 *   - sources disagree with our clock. A feed whose timestamps run a few hours
 *     ahead is normal, and a signal must never be dropped for arriving from
 *     the future.
 *
 * In live operation the newest signal IS roughly now, so the two definitions
 * coincide and the window means exactly what an operator expects: "the last N
 * minutes of the picture".
 *
 * `windowMins` absent means no lower bound — everything we hold.
 */

export type Window = { from: Date; to: Date; anchor: Date };

/** The lower bound used when no window is asked for: the whole history. */
const BEGINNING_OF_TIME = new Date(0);

export function resolveWindow(args: {
  /** Newest occurred_at in the data, or null when there is nothing stored. */
  latestOccurredAt: Date | null;
  windowMins?: number;
  /** Injectable for tests; defaults to the wall clock. */
  now?: Date;
}): Window {
  const now = args.now ?? new Date();
  const anchor =
    args.latestOccurredAt && args.latestOccurredAt.getTime() > now.getTime()
      ? args.latestOccurredAt
      : now;

  const from =
    args.windowMins === undefined
      ? BEGINNING_OF_TIME
      : new Date(anchor.getTime() - args.windowMins * 60_000);

  return { from, to: anchor, anchor };
}
