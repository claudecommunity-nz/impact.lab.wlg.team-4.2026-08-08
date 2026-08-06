<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# claude-impact-wellington-t4

Base project for Wellington Impact Lab team 4. Layered clean architecture — the
`notes` entity is the reference vertical slice; copy its shape file-for-file when
adding anything new.

## Read the docs before writing code

`docs/` defines how this codebase is written; each layer folder also has its own
CLAUDE.md with the local rules. Read the relevant guide BEFORE touching a layer —
do not improvise patterns:

- [`docs/architecture.md`](docs/architecture.md) — layers, dependency rules, naming, the two caches
- [`docs/api.md`](docs/api.md) — the tRPC boundary: routers, procedures, callUseCase
- [`docs/repositories.md`](docs/repositories.md) — DB access (Drizzle)
- [`docs/use-cases.md`](docs/use-cases.md) — the factory, three kinds of use case, composition
- [`docs/ai.md`](docs/ai.md) — AI via Gateway, structured output
- [`docs/frontend.md`](docs/frontend.md) — the feature block (server/client/skeleton)
- [`docs/data-fetching.md`](docs/data-fetching.md) — TanStack Query over tRPC, hydration, policy hooks
- [`docs/logging.md`](docs/logging.md) — pino, modules, what to log

## Non-negotiables (the short version)

1. **One transport: tRPC.** No server actions, no hand-written API routes. All
   client↔server traffic goes through procedures in
   `use-cases/<domain>/<domain>-router.ts`, merged in `trpc/router.ts`.
2. **Procedures are a transport skin — a procedure with an `if` in it is a bug.**
   Pure-fetch queries wrap ONE repo call; everything else is one line:
   `callUseCase(someUseCase({ ...input, log: ctx.log }))`.
3. **Business-logic use cases compose OTHER USE CASES — never repos, never raw
   SDKs.** Repos are reached only by thin CRUD use cases and pure-fetch query
   procedures; external APIs only by thin integration use cases (`use-cases/ai/`).
   Workflows call use cases directly — logic stays reachable without HTTP.
4. Every use case is built with `createUseCase` and returns `{ data, error }` —
   never throws to callers, never swallows errors. The conversion to thrown
   errors happens ONLY in procedures, via `callUseCase` (`utilities/`).
5. **Two caches, keys managed by tRPC** — no hand-written query keys. Server:
   per-request QueryClient (RSC prefetch + `ctx.queryClient` dedupe). Client:
   hydrated browser cache; mutations invalidate via `queryFilter()`/`pathFilter()`
   in policy hooks (invalidate-and-toast, no optimistic surgery).
6. Only `-client` files call hooks: reads straight off the proxy
   (`useQuery(trpc.x.y.queryOptions())`), writes via policy hooks.
7. Model ids live ONLY in `use-cases/ai/models.ts` (plain strings → AI Gateway).
   Model output only via `generateText` + `Output.object({ schema })` —
   `generateObject` is deprecated.
8. External fetching/polling lives in `workflows/` (`"use workflow"` / `"use step"`),
   never in routes or components.
9. Structured pino logging via `utilities/logger.ts` — no `console.log` in committed code.

## Stack

Next.js (App Router, Turbopack) · TypeScript strict · Tailwind v4 + shadcn/ui (all
components pre-installed in `components/ui/`) · AI Elements (all components in
`components/ai-elements/` — default for any AI/chat UI) · tRPC v11 (+ TanStack React
Query integration, superjson) · Drizzle ORM + Postgres (Supabase hosted / Docker
local) · Vercel AI SDK v7 via AI Gateway · Vercel Workflows · pino · zod.

Adding an entity? Run the `new-entity` skill — it stamps the full vertical slice
from the notes reference.

## Skills

`.claude/skills/` ships in this repo: `ai-sdk` (how to look up current AI SDK docs),
`frontend-design`, `vercel-react-best-practices`, `web-design-guidelines`. Load them
when working in their area. Bundled reference docs also live in
`node_modules/ai/docs/`, `node_modules/workflow/docs/`, `node_modules/next/dist/docs/`.

## Commands

```bash
npm run dev            # dev server (Turbopack)
npm run db:push        # push db/schema.ts to Postgres (drizzle-kit push)
npm run typecheck      # tsc --noEmit — run before handing work back
npm run lint           # eslint
npx workflow web       # inspect workflow runs locally
```

First-time DB setup: set `DATABASE_URL` in `.env.local` (local Docker Postgres or
a Supabase project — see `.env.example`), then `npm run db:push`.

## Env (.env.local — see .env.example)

- `DATABASE_URL` — Postgres connection string (Supabase pooler in prod, local Docker in dev)
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway key (covers Claude models AND embeddings)
- `LOG_LEVEL` — pino level (default `info`)
