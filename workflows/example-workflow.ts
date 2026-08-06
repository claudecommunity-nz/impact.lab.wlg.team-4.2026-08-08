import { sleep } from "workflow";

/**
 * Example durable workflow — the reference for the jobs pattern. Workflows are
 * the ONLY place external polling/long-running jobs live. Steps do the IO;
 * the workflow body is orchestration. Inspect runs with `npx workflow web`.
 */
export async function exampleWorkflow(input: { name: string }) {
  "use workflow";

  const greeting = await buildGreeting(input.name);
  await sleep("10s"); // suspends without consuming compute
  return { greeting };
}

async function buildGreeting(name: string) {
  "use step";
  return `Hello, ${name}!`;
}
