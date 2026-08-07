import type { IncomingAnnotation, IncomingSignal } from "@/db/vocabulary";

/**
 * The adapter contract.
 *
 * An adapter does exactly ONE job: render a source payload as an honest
 * sentence and attach whatever structure the source already knows as `feed`
 * annotations. `raw` keeps the original forever. Downstream never learns the
 * source type — it sees text, time, maybe geo, and annotations. That is how one
 * schema absorbs a tweet, a gauge reading, a CAP polygon and a radio note.
 *
 * Adapters ABSORB ALL SHAPE BURDEN, so they must never throw: weird input
 * degrades into `{ ok: false, reason }` and the batch keeps going.
 *
 * These are pure functions — no IO, no db, no logging — with zod and
 * `db/vocabulary` as their only imports. They live next to the pollers that
 * feed them, and any layer may import them.
 */
export type AdapterResult =
  | { ok: true; signal: IncomingSignal }
  | { ok: false; reason: string };

export type Adapter = (payload: unknown) => AdapterResult;

export type { IncomingAnnotation, IncomingSignal };
