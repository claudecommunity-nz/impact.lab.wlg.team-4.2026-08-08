import "server-only";
import { createTRPCOptionsProxy, type TRPCQueryOptions } from "@trpc/tanstack-react-query";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { appRouter } from "./router";
import { createContext } from "./init";
import { getQueryClientServer } from "@/utilities/get-query-client-server";

/**
 * Server-side tRPC proxy — same queryOptions API as the client, but queryFn
 * calls the procedure in-process (no HTTP). Used by feature -server components.
 */
export const trpc = createTRPCOptionsProxy({
  ctx: createContext,
  router: appRouter,
  queryClient: getQueryClientServer,
});

/** Fire-and-forget prefetch into the per-request client — streams via pending dehydration. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC docs' canonical helper signature
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(queryOptions: T) {
  const queryClient = getQueryClientServer();
  if (queryOptions.queryKey[1]?.type === "infinite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    void queryClient.prefetchQuery(queryOptions);
  }
}

/** Wrap a feature's -client subtree so prefetched data hydrates into the browser cache. */
export function HydrateClient({ children }: { children: React.ReactNode }) {
  return (
    <HydrationBoundary state={dehydrate(getQueryClientServer())}>{children}</HydrationBoundary>
  );
}
