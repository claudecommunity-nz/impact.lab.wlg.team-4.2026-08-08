# API layer — tRPC

All client↔server traffic goes through ONE system: tRPC procedures in per-domain
routers. There are no server actions and no hand-written API routes (the single
`/api/trpc/[trpc]` handler serves everything — batched, parallel, superjson-encoded).

## Where things live

```
trpc/init.ts                     initTRPC + createContext (injects `log`) — rarely touched
trpc/router.ts                   appRouter — add one line per new domain router
trpc/server.tsx                  RSC proxy: `trpc`, `prefetch()`, `<HydrateClient>`
trpc/client.tsx                  `useTRPC` for -client components
use-cases/<domain>/<domain>-router.ts   ← the file you actually write
```

## Procedures are the boundary, nothing more

**A procedure with an `if` in it is a bug.** Two shapes only:

```ts
export const notesRouter = router({
  // QUERY, pure fetch: wraps exactly ONE repo call (the thin-CRUD role)
  list: publicProcedure
    .output(z.array(NoteSchema))
    .query(() => getNotesRepo({ db })),

  // MUTATION: one line into a business-logic use case
  capture: publicProcedure
    .input(z.object({ title: z.string().min(1).optional(), content: z.string().min(1) }))
    .output(NoteSchema)
    .mutation(({ ctx, input }) => callUseCase(captureNoteUseCase({ ...input, log: ctx.log }))),
});
```

- `.input()` / `.output()` zod on every procedure — same boundary-validation
  guarantee the action layer had.
- `ctx.log` is the request logger — pass it into every use case call.
- `callUseCase` (utilities/) is the ONE seam between `{ data, error }` use-case
  results and thrown TRPCErrors. Only ever used inside procedures.

## The read-promotion rule

Start every read as a procedure wrapping the repo directly. Promote to a read
use case (procedure becomes `callUseCase(...)`) the moment EITHER happens:

1. Logic creeps in — derived fields, combining repos, filtering policy.
2. A second caller appears — another use case or a workflow needs the same read.

Business logic never lives in procedures, because procedures are only reachable
over the wire — workflows and composed use cases need logic transport-free.

## Why tRPC (and not server actions) for reads

Server actions POST and are processed serially per client — concurrent polls
queue behind each other. tRPC queries run in parallel and `httpBatchLink` folds
concurrent queries (several polls firing on one tick) into a single HTTP request.

## Adding a domain

1. `use-cases/<domain>/<domain>-router.ts` — procedures as above
2. One line in `trpc/router.ts`: `<domain>: <domain>Router`
3. Client and server callers are typed immediately — nothing else to write.
