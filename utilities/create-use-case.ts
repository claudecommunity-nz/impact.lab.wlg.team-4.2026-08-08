import "server-only";
import { type QueryClient } from "@tanstack/react-query";
import { getQueryClientServer } from "./get-query-client-server";
import { type Logger } from "./logger";
import { z } from "zod";

export type UseCaseResult<TData> =
  | { data: TData; error: null }
  | { data: null; error: { message: string; [key: string]: unknown } };

export type UseCaseCtx<TData> = {
  success: (data: TData) => UseCaseResult<TData>;
  error: (err: { message: string; [key: string]: unknown }) => UseCaseResult<TData>;
  /**
   * The per-request server cache. READ use cases wrap their repo call:
   * `queryClient.fetchQuery({ queryKey, queryFn: () => repo(...) })` — same key
   * requested twice in one request = one DB query. This is why composed use
   * cases re-fetch instead of receiving data as parameters.
   */
  queryClient: QueryClient;
};

// ─── createUseCase ────────────────────────────────────────────────────────────
//
// Every piece of business logic is a use case built with this factory. The
// factory owns logging and error trapping so handlers stay pure business logic.
//
// - inputSchema / outputSchema are always required; TArgs derives from
//   inputSchema — no separate arg types.
// - `log` is injected by the caller (usually createServerAction) — it does not
//   belong in inputSchema.
// - Handlers NEVER throw to the caller: the factory catches and returns
//   { data: null, error }. Use ctx.error() for expected failures.
// - The returned fn carries its schemas so createServerAction can validate at
//   the network boundary.
//
//   export const getNotesUseCase = createUseCase(
//     {
//       id: "get-notes",
//       inputSchema: z.object({}),
//       outputSchema: z.array(NoteSchema),
//     },
//     async ({ success }, { log }) => {
//       const rows = await getNotesRepo({ db });
//       return success(rows);
//     },
//   );
//
export function createUseCase<TDataSchema extends z.ZodType, TArgsSchema extends z.ZodType>(
  config: {
    id: string;
    inputSchema: TArgsSchema;
    outputSchema: TDataSchema;
  },
  handler: (
    ctx: UseCaseCtx<z.infer<TDataSchema>>,
    args: z.infer<TArgsSchema> & { log?: Logger },
  ) => Promise<UseCaseResult<z.infer<TDataSchema>>>,
): ((
  args: z.infer<TArgsSchema> & { log?: Logger },
) => Promise<UseCaseResult<z.infer<TDataSchema>>>) & {
  inputSchema: TArgsSchema;
  outputSchema: TDataSchema;
} {
  const fn = async (args: z.infer<TArgsSchema> & { log?: Logger }) => {
    const { log } = args;
    try {
      log?.info({ useCaseId: config.id }, "Use case: starting");

      const ctx: UseCaseCtx<z.infer<TDataSchema>> = {
        success: (data) => ({ data, error: null }),
        error: (err) => ({ data: null, error: err }),
        queryClient: getQueryClientServer(),
      };

      const result = await handler(ctx, args);
      log?.info({ useCaseId: config.id, ok: result.error === null }, "Use case: completed");
      return result;
    } catch (err) {
      log?.error({ err, useCaseId: config.id }, `Error in use case: ${config.id}`);
      return {
        data: null,
        error: { message: `Failed to execute use case: ${config.id}`, cause: err },
      };
    }
  };

  return Object.assign(fn, {
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
  });
}
