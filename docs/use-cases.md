# Use cases

All business logic AND all third-party calls live in use cases built with
`createUseCase` from `@/utilities/create-use-case`. The factory owns logging,
error trapping, and the per-request server cache; handlers stay pure.

Procedures (see [api.md](./api.md)) are the transport skin over this layer —
they never contain logic. Workflows call use cases directly. Logic must stay
reachable without HTTP.

## Three kinds

**Thin CRUD use cases** wrap exactly one repo call, no logic
(`create-note-use-case.ts`). The only callers of repos — with ONE exception:
pure-fetch query procedures may wrap a repo call directly (that's the thin-CRUD
role absorbed into the boundary; see the promotion rule in api.md).

**Thin integration use cases** wrap exactly one external call, no logic — the
third-party twin of thin CRUD. Organised by domain folder:
`use-cases/ai/suggest-note-title-use-case.ts`.

**Business-logic use cases** compose OTHER USE CASES — never repos, never raw
external SDKs. `capture-note-use-case.ts` is the reference: resolve a title via
the AI integration use case, then call `createNoteUseCase`.

```
repo ──────────────► thin CRUD ─────────┐
                                        ├─► business logic ─► procedure ─► client
external API ──────► thin integration ──┘
```

The common slip-up is a business-logic use case reaching past the use-case layer
into a repo or an SDK. If you're importing from `repositories/` (or calling an
SDK) and your handler has any logic beyond the one call — split it.

## Server-side caching (composed reads)

A read use case wraps its repo call in the per-request server cache:

```ts
async ({ success, queryClient }) => {
  const rows = await queryClient.fetchQuery({
    queryKey: ["notes", "byIds", ids],
    queryFn: () => getNotesByIdsRepo({ db, ids }),
  });
  return success(rows);
}
```

Any number of use cases requesting that key within one request = ONE DB query.
This is why composition passes ids, never fetched data — the callee re-fetches
for free.

## Creating a client-facing operation

- **Read**: usually just a procedure in `<domain>-router.ts` (see api.md).
- **Write**: `<verb>-<entity>-use-case.ts` + a 3-line mutation procedure +
  `use-<verb>-<entity>.ts` policy hook (invalidate-and-toast).

Internal (composed-only) use cases need nothing else.

## Rules

- **Every use case returns `UseCaseResult` — `{ data, error }`.** Never throw to the
  caller; never swallow errors and return a fallback (`null`, `{}`). When composing,
  check `.error` and propagate. The `{ data, error }` → thrown-error conversion
  happens ONLY in procedures, via `callUseCase`.
- **inputSchema and outputSchema are always required.** Arg types derive from
  inputSchema — no separate exported types. `log` comes from the procedure's
  `ctx.log` and is passed down through every composed call; it does not belong
  in inputSchema.
- **Any fallible IO is a use case** — never a bare helper returning a value that
  throws mid-operation.
- **Generic beats specific.** Prefer `updateNoteUseCase` over `updateNoteTitleUseCase` +
  `updateNoteContentUseCase`. Before adding a use case, check one doesn't already cover it.
- **Each use case fetches ALL its own dependencies.** Never pass fetched data between
  use cases as parameters — pass ids; the server cache makes the re-fetch free.
