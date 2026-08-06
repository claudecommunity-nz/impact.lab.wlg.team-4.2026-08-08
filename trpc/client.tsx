"use client";

import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "./router";

/** Client-side tRPC context. -client components: useTRPC() → queryOptions/mutationOptions. */
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
