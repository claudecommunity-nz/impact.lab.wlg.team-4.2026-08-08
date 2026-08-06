import "server-only";
import { cache } from "react";
import { makeQueryClient } from "./query-client";

/**
 * THE per-request server QueryClient (React cache() = one instance per request).
 * Shared by: the tRPC RSC proxy (prefetch), feature -server components
 * (dehydrate), and use cases (ctx.queryClient.fetchQuery) — same instance, so a
 * key fetched anywhere in the request is fetched once.
 */
export const getQueryClientServer = cache(makeQueryClient);
