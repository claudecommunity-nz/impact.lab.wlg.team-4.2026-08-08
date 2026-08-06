# Frontend

## The feature block — three files (plus optional extras)

Every data-bearing feature is a folder in `features/`:

```
features/notes/
  notes-server.tsx      the feature entry — exports what pages render:
                        ErrorBoundary → Suspense(skeleton) → prefetch (tRPC RSC
                        proxy, in-process) → <HydrateClient> → client
  notes-client.tsx      "use client": the ONLY file that calls hooks; branches
                        isLoading → skeleton, isError → <FeatureError>
  notes-skeleton.tsx    mirrors the client's layout — Skeleton blocks ONLY on the
                        awaited data; static chrome renders for real (inert)
  components/           (optional, bigger features) presentational pieces:
                        props in, callbacks out
  <feature>-error.tsx   (optional) only when the shared <FeatureError> isn't enough
```

Pages stay trivially thin — compose feature entries, nothing else:

```tsx
export default function NotesPage() {
  return <main className="flex-1"><Notes /></main>;
}
```

Why this shape: first paint is real server-rendered data (prefetch + hydration,
no flash); the skeleton streams while the server half runs and covers client
refetches; errors default to the shared `components/errors/feature-error.tsx`;
and hooks live in exactly one file per feature, so data flow is greppable.

## Rules

- `"use client"` goes on `-client` files and interactive presentational pieces —
  never on pages or `-server` files.
- **Only `-client` files call hooks**: reads via
  `useQuery(trpc.<domain>.<proc>.queryOptions())`, writes via the feature's
  policy hooks. Presentational components take props and fire callbacks — no
  hooks (local `useState` for widget state is fine), no fetching, no toasts.
- Server state belongs to TanStack Query — never copy query data into `useState`.
- Live views poll via `refetchInterval` in queryOptions — no hand-rolled timers.
- Toasts fire in mutation policy hooks, not components.
- **Skeletons cover only dynamic data.** Headings, labels, forms, card frames —
  anything not waiting on a fetch — renders normally (inert where interactive);
  `<Skeleton>` blocks go exactly where awaited data will appear. The loading
  state should look like the page, not a wireframe of it.
- **Long lists virtualize with TanStack Virtual.** Any list that can exceed
  ~100 rows uses `useVirtualizer` — fixed-height scroll container, spacer div
  owning `getTotalSize()`, rows absolutely positioned by `translateY(start)`,
  dynamic heights via `data-index` + `measureElement`, and the row gap INSIDE
  the measured element. Reference: the list in `features/notes/notes-client.tsx`.
  Known trade-off: the list materialises on hydration (the virtualizer needs its
  scroll element), while the rest of the page still server-renders real data.
- Styling: Tailwind utilities; theme tokens (`text-muted-foreground`, `bg-card`,
  etc.) over raw colours. shadcn primitives from `@/components/ui/<name>` (all
  pre-installed) — never hand-roll a button/card/dialog/input/skeleton.
- Boundary components live in `components/errors/` (`ErrorBoundary`, `FeatureError`).

## Skills

`.claude/skills/` ships with `frontend-design` (build distinctive UI),
`vercel-react-best-practices` (performance patterns), and `web-design-guidelines`
(accessibility/UX review). Load them when doing substantial UI work.
