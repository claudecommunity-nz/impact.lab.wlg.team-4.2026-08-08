import "server-only";
import { TRPCError } from "@trpc/server";
import { type UseCaseResult } from "./create-use-case";

/**
 * The ONE seam between the use-case world ({ data, error } results) and the
 * client world (thrown errors → TanStack Query). Used only inside procedures:
 *
 *   .mutation(({ ctx, input }) =>
 *     callUseCase(captureNoteUseCase({ ...input, log: ctx.log })))
 */
export async function callUseCase<TData>(result: Promise<UseCaseResult<TData>>): Promise<TData> {
  const r = await result;
  if (r.error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: r.error.message });
  }
  return r.data;
}
