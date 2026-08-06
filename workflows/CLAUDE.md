# Workflows — how to work in this folder

The ONLY place external polling and long-running jobs live — never in routes,
components, or use cases.

- Workflow fns carry `"use workflow"`; each IO step is a separate fn with
  `"use step"`. `sleep()` between rounds suspends without consuming compute.
- Workflows orchestrate; steps do the work. Steps call use cases.
- Start from a route handler: `start(workflowFn, [args])` from `workflow/api`.
- Workflows create their own logger: `getLogger({ module: LoggerModule.Jobs })`.
- Inspect runs: `npx workflow web`. Bundled docs: `node_modules/workflow/docs/`.
- `next.config.ts` is already wrapped with `withWorkflow` — don't remove it.

Reference: `workflows/example-workflow.ts` + `app/api/workflows/example/route.ts`.
