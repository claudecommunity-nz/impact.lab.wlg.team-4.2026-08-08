# Architecture

Layered clean architecture, one transport. Every request flows the same way:

```
page (app/ — renders feature entries, nothing else)
  └─ <feature>-server (ErrorBoundary → Suspense → prefetch via tRPC RSC proxy → HydrateClient)
      └─ <feature>-client ("use client" — the ONLY place hooks are called)
          ├─ reads:  useQuery(trpc.<domain>.<proc>.queryOptions())      [no hook file]
          └─ writes: policy hook (use-<verb>-<entity>.ts — invalidate-and-toast)
                └─ tRPC procedure (use-cases/<domain>/<domain>-router.ts — the boundary)
                    ├─ query, pure fetch → ONE repo call (thin-CRUD role)
                    ├─ query, has logic  → callUseCase(read use case)
                    └─ mutation          → callUseCase(business-logic use case)
                          └─ business-logic use case (composes use cases — never repos)
                              ├─ thin CRUD use case → repository → db
                              └─ thin integration use case → external API (use-cases/ai/)
```

Business logic lives in `createUseCase` files — procedures are a transport skin.
Workflows call use cases directly (never procedures): logic stays reachable
without HTTP.

## Two caches, keys managed by tRPC

- **Server**: per-request QueryClient (`utilities/get-query-client-server.ts`) —
  shared by the RSC proxy's `prefetch`, feature `-server` dehydration, and
  `ctx.queryClient` inside use cases. One fetch per key per request.
- **Client**: browser QueryClient (`app/providers.tsx`) — hydrated from the
  server, refreshed over the batched `/api/trpc` endpoint, invalidated by
  mutation policy hooks via `queryFilter()`/`pathFilter()`.

Both come from `utilities/query-client.ts`. No hand-written query keys anywhere.

## Dependency rules

| Layer | May import from | Never imports |
|---|---|---|
| `app/` pages | `features/` entries | everything else |
| `features/` `-server` | own feature files, `trpc/server` | repos, db, use cases directly |
| `features/` `-client` | `trpc/client`, policy hooks, `components/ui/`, own feature files | repos, db, `trpc/server` |
| `features/` `components/` | `components/ui/`, entity types | hooks, trpc, use cases |
| routers (`*-router.ts`) | `trpc/init`, use cases, repos (pure-fetch queries only) | React, `features/` |
| `use-cases/` (thin CRUD) | its entity's `repositories/`, `db`, `utilities/` | React, `features/`, `trpc/` |
| `use-cases/` (thin integration) | external SDKs, `utilities/` | repos, db |
| `use-cases/` (business logic) | other use cases, `utilities/` | repos, raw SDKs, `trpc/` |
| `repositories/` | `db`, own entity schema | anything upward |
| `workflows/` | `use-cases/`, `utilities/` | React, `app/`, `trpc/` |

Lower layers never import upward. If you feel the need, the logic is in the wrong layer.

## File naming

Kebab-case, suffix says the layer: `capture-note-use-case.ts`, `notes-router.ts`,
`create-note-repo.ts`, `use-capture-note.ts`, `note-schema.ts`. One entity folder
per layer: `repositories/notes/`, `use-cases/notes/`; domain folders for
integrations: `use-cases/ai/`.

## The reference example

The `notes` entity is the reference implementation — one full vertical slice:
`db/schema.ts` → `repositories/notes/` → `use-cases/notes/` (router + write use
cases + policy hook) + `use-cases/ai/` (thin integration) → `features/notes/`
(server/client/skeleton) → `app/notes/page.tsx` (thin), with a durable job at
`workflows/example-workflow.ts`. When adding an entity, copy its shape
file-for-file — or run the `new-entity` skill, which stamps the whole slice.

## Layer guides

- [API layer (tRPC)](./api.md)
- [Repositories](./repositories.md)
- [Use cases](./use-cases.md)
- [AI](./ai.md)
- [Frontend](./frontend.md)
- [Data fetching](./data-fetching.md)
- [Logging](./logging.md)
