import { z } from "zod";
import { router, publicProcedure } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import { collectSignalsUseCase } from "./collect-signals-use-case";

/**
 * The domain's transport boundary. Every procedure is a one-line callUseCase —
 * no branching, no logic.
 *
 * `collect` is a query rather than a mutation because it is a read of the
 * outside world: the UI can put it behind `refetchInterval` for a live view.
 */
export const signalsRouter = router({
  collect: publicProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
          sinceHours: z.number().int().positive().optional(),
          datasetId: z.string().optional(),
          upload: z.boolean().optional(),
          write: z.boolean().optional(),
          outputDir: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      callUseCase(collectSignalsUseCase({ ...(input ?? {}), log: ctx.log })),
    ),
});
