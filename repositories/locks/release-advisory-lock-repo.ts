import { heldAdvisoryLocks } from "./acquire-advisory-lock-repo";

/**
 * Releases on the SAME connection that took the lock, then returns it to the
 * pool. Unknown or already-released tokens are a no-op returning false — a
 * double release must never throw inside a `finally`.
 */
export async function releaseAdvisoryLockRepo(args: { token: string }): Promise<boolean> {
  const held = heldAdvisoryLocks.get(args.token);
  if (!held) return false;

  heldAdvisoryLocks.delete(args.token);
  try {
    await held.client.query("select pg_advisory_unlock($1)", [held.key]);
    return true;
  } finally {
    held.client.release();
  }
}
