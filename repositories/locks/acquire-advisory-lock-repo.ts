import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { type Db } from "@/db";

/**
 * A Postgres session advisory lock — the mutual exclusion that stops two
 * concurrent pipeline runs from assigning the same signal to two groups.
 *
 * Why this is not a one-liner: `pg_advisory_lock` is scoped to a CONNECTION,
 * and the pool hands out whichever client is idle, so locking on one connection
 * and unlocking on another would leak the lock forever. This checks a client
 * OUT of the pool for the lifetime of the lock and hands back a token; the
 * release repo returns the same client. Connection bookkeeping is database
 * business, so it lives in this layer and nowhere else.
 *
 * Locks are per-process-lifetime: if the process dies the connection closes and
 * Postgres drops the lock automatically. No stale-lock table to clean up.
 */

/** token → the connection actually holding the lock. Read by release-advisory-lock-repo. */
export const heldAdvisoryLocks = new Map<string, { client: PoolClient; key: number }>();

/** Returns a release token, or null when someone else already holds the lock. */
export async function acquireAdvisoryLockRepo(args: {
  db: Db;
  key: number;
}): Promise<string | null> {
  const client = await args.db.$client.connect();

  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [args.key],
    );

    if (result.rows[0]?.locked !== true) {
      client.release();
      return null;
    }
  } catch (err) {
    client.release();
    throw err;
  }

  const token = randomUUID();
  heldAdvisoryLocks.set(token, { client, key: args.key });
  return token;
}
