"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import superjson from "superjson";
import { Toaster } from "sonner";
import { TRPCProvider } from "@/trpc/client";
import type { AppRouter } from "@/trpc/router";
import { makeQueryClient } from "@/utilities/query-client";

/**
 * Browser QueryClient singleton (module scope, not useState — survives React
 * suspending during render). Server renders always make a fresh client.
 */
let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        // Batching folds concurrent queries (e.g. several polls on one tick)
        // into a single HTTP request.
        httpBatchLink({ url: "/api/trpc", transformer: superjson }),
      ],
    }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {children}
          <Toaster richColors />
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
