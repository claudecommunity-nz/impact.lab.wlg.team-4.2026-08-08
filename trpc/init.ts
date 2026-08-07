import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { getLogger, LoggerModule, type Logger } from "@/utilities/logger";

export type TRPCContext = { log: Logger };

/** Per-request context — injects the logger every procedure passes down to use cases. */
export function createContext(): TRPCContext {
  return { log: getLogger({ module: LoggerModule.Crud }) };
}

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
