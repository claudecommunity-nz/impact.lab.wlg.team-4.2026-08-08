# Data fetching — TanStack Query over tRPC

Two caches, keys managed by tRPC (no hand-written key files):

- **Server (per request)**: `utilities/get-query-client-server.ts` — the tRPC RSC
  proxy prefetches into it; use cases dedupe through it (`ctx.queryClient`).
- **Client**: the browser QueryClient in `app/providers.tsx` — hydrated from the
  server, refreshed over `/api/trpc`, invalidated by mutation policy hooks.

Both are built by `utilities/query-client.ts` (`makeQueryClient`) — one config,
superjson (de)hydration included. Never `new QueryClient()` anywhere else.

## Reads — no hook files

`-client` components query the tRPC proxy directly:

```ts
const trpc = useTRPC();
const notes = useQuery(trpc.notes.list.queryOptions());
// live views:
const incidents = useQuery(trpc.incidents.list.queryOptions(undefined, { refetchInterval: 2000 }));
```

Branch `isLoading` → the feature skeleton, `isError` → `<FeatureError>`. With
server prefetch those branches only show on client-side refetch paths.

Only write a read hook file when a read accrues real client-side policy worth
centralising — that's the promotion path, not the default.

## Server prefetch (in `<feature>-server.tsx`)

```tsx
import { trpc, prefetch, HydrateClient } from "@/trpc/server";

async function NotesContent() {
  prefetch(trpc.notes.list.queryOptions());   // in-process, no HTTP; streams
  return <HydrateClient><NotesClient /></HydrateClient>;
}
```

Same `queryOptions` API as the client, same auto-managed keys — which is what
makes hydration line up with zero coordination.

## Mutations — policy hooks (`use-<verb>-<entity>.ts`)

Components call the policy hook, never the raw mutation. The hook owns
invalidate-and-toast in exactly one place:

```ts
export function useCaptureNote() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.notes.capture.mutationOptions({
      onSuccess: () => toast.success("Note created"),
      onError: (error) => toast.error("Failed to create note", { description: error.message }),
      onSettled: () => queryClient.invalidateQueries(trpc.notes.list.queryFilter()),
    }),
  );
}
```

- Invalidation targets come from the proxy: `trpc.notes.list.queryFilter()` for
  one query, `trpc.notes.pathFilter()` for the whole domain.
- **No optimistic cache surgery** — the refetch after invalidation is the source
  of truth. Edit panels hold their own draft state.

## Rules

- Server state belongs to TanStack Query — never copy query data into `useState`.
- Polling via `refetchInterval` in queryOptions — no hand-rolled timers.
- `staleTime` default is 30s (`utilities/query-client.ts`) so hydrated data isn't
  instantly refetched; live queries override per-call.
