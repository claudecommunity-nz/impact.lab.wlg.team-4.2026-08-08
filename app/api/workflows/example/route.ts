import { start } from "workflow/api";
import { exampleWorkflow } from "@/workflows/example-workflow";

/** Workflows are started from route handlers via start(). */
export async function POST() {
  await start(exampleWorkflow, [{ name: "world" }]);
  return Response.json({ started: true });
}
