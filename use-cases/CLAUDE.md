# Use cases — how to work in this folder

Full guide: @docs/use-cases.md · API boundary: @docs/api.md · AI: @docs/ai.md

All business logic, all third-party calls, AND each domain's tRPC router live
here. Logic is built with `createUseCase` from `@/utilities/create-use-case`;
the router (`<domain>-router.ts`) is the transport skin over it.

## The boundary: `<domain>-router.ts`

- Query, pure fetch → wraps exactly ONE repo call. Promote to a read use case
  when logic creeps in or a second caller appears.
- Mutation → one line: `callUseCase(someUseCase({ ...input, log: ctx.log }))`.
- `.input()`/`.output()` zod on every procedure. **A procedure with an `if` in
  it is a bug.** New domain → one line in `trpc/router.ts`.

## Three kinds of use case — keep them separate

- **Thin CRUD**: wraps exactly ONE repo call, no logic. (`notes/create-note-use-case.ts`)
- **Thin integration**: wraps exactly ONE external call, no logic. Domain
  folders: `ai/`. Model ids only in `ai/models.ts`; generation only via
  `generateText` + `Output.object({ schema })` — `generateObject` is deprecated.
  (`ai/suggest-note-title-use-case.ts`)
- **Business logic**: composes OTHER USE CASES — never repos, never raw SDKs.
  Check `.error` on every composed call and propagate. (`notes/capture-note-use-case.ts`)

If your handler imports from `repositories/` (or calls an SDK) AND has logic
beyond the one call — split it.

## Files per operation

- **Read**: usually just a procedure in the router.
- **Write**: use case + 3-line mutation procedure + `use-<verb>-<entity>.ts`
  policy hook (invalidate-and-toast via `trpc.<domain>.<proc>.queryFilter()`).
- Internal (composed-only) use cases need nothing else.

## Rules

- Always return `{ data, error }` — never throw to callers, never swallow errors.
  The conversion to thrown errors happens ONLY in procedures via `callUseCase`.
- `inputSchema`/`outputSchema` always required; arg types derive from inputSchema.
- Pass `log` (from `ctx.log`) down through every composed call.
- Each use case fetches ALL its own dependencies — pass ids, never fetched data
  (composed reads dedupe via `ctx.queryClient.fetchQuery`).
- Generic beats specific; check an existing use case doesn't already cover the need.
- Workflows call use cases directly — never procedures.
