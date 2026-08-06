import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * One QueryClient config for both sides: the browser singleton (app/providers.tsx)
 * and the per-request server client (get-query-client-server.ts). superjson
 * (de)hydration keeps Dates/Maps intact across the RSC boundary; dehydrating
 * pending queries enables streaming prefetches.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Above 0 so hydrated data isn't refetched immediately on mount.
        // Live views override per-query with refetchInterval.
        staleTime: 30_000,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  });
}
