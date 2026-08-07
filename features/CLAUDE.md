# Features — how to work in this folder

Full guide: @docs/frontend.md · Data fetching: @docs/data-fetching.md

Every data-bearing feature is a folder with the three-file block:

```
<feature>-server.tsx    the feature entry (what pages render): ErrorBoundary →
                        Suspense(skeleton) → prefetch(trpc.<domain>.<proc>.queryOptions())
                        → <HydrateClient> → client
<feature>-client.tsx    "use client": the ONLY file that calls hooks; branches
                        isLoading → skeleton, isError → <FeatureError>
<feature>-skeleton.tsx  mirrors the client's layout; Skeleton blocks ONLY on
                        awaited data — static chrome renders for real (inert)
components/             (optional) presentational: props in, callbacks out
<feature>-error.tsx     (optional) only when shared <FeatureError> isn't enough
```

- Pages render feature entries and nothing else.
- Only `-client` files call hooks: reads via
  `useQuery(trpc.<domain>.<proc>.queryOptions())` (no read-hook files), writes
  via the domain's policy hooks (`use-cases/<domain>/use-*.ts`).
- Presentational components never import hooks or trpc — local `useState` for
  widget state only.
- Server state stays in TanStack Query — never copy it into `useState`.
- Live views: `refetchInterval` in queryOptions, not timers.
- Lists that can exceed ~100 rows: TanStack Virtual (`useVirtualizer`) — copy
  the list in `notes-client.tsx` (spacer + translateY + measureElement).
- Toasts fire in mutation policy hooks, not components.
- shadcn primitives from `@/components/ui/<name>`; boundaries from
  `@/components/errors/`; AI/chat UI from `@/components/ai-elements/<name>` —
  never hand-roll message threads, prompt boxes, or streaming displays.

Reference: `features/notes/`.
