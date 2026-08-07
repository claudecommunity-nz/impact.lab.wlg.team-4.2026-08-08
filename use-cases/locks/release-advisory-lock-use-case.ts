import { z } from "zod";
import { releaseAdvisoryLockRepo } from "@/repositories/locks/release-advisory-lock-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — releases the lock on the connection that took it. */
export const releaseAdvisoryLockUseCase = createUseCase(
  {
    id: "release-advisory-lock",
    inputSchema: z.object({ token: z.string().min(1) }),
    outputSchema: z.object({ released: z.boolean() }),
  },
  async ({ success }, { token }) =>
    success({ released: await releaseAdvisoryLockRepo({ token }) }),
);
