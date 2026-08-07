import { z } from "zod";
import { db } from "@/db";
import { getLatestOccurredAtRepo } from "@/repositories/signals/get-latest-occurred-at-repo";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the anchor for every windowed read (see
 * utilities/window.ts). Cached per request, so points and groups asked for in
 * one batch resolve the same window from one query and cannot disagree about
 * where "now" is.
 */
export const getLatestOccurredAtUseCase = createUseCase(
  {
    id: "get-latest-occurred-at",
    // Loose rather than `z.object({})`: this use case takes no arguments, and a
    // strict empty object types away the `log` every caller passes down.
    inputSchema: z.looseObject({}),
    outputSchema: z.date().nullable(),
  },
  async ({ success, queryClient }) => {
    const latest = await queryClient.fetchQuery({
      queryKey: ["signals", "latestOccurredAt"],
      queryFn: () => getLatestOccurredAtRepo({ db }),
    });
    return success(latest);
  },
);
