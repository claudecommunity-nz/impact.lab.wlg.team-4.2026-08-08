import { start } from "workflow/api";
import { inboxPollerWorkflow } from "@/workflows/inbox-poller";

/**
 * Starts the drop-folder poller. Workflows are started from route handlers via
 * start() — this is the one kind of hand-written route the architecture allows.
 *
 *   curl -X POST localhost:3000/api/workflows/inbox-poller \
 *     -H 'content-type: application/json' -d '{"rounds":1,"intervalSeconds":1}'
 */
export async function POST(req: Request) {
  const input = await req.json().catch(() => ({}));
  await start(inboxPollerWorkflow, [input]);
  return Response.json({ started: true, input });
}
