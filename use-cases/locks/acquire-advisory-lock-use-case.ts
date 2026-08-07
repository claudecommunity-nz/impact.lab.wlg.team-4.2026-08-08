import { z } from "zod";
import { db } from "@/db";
import { acquireAdvisoryLockRepo } from "@/repositories/locks/acquire-advisory-lock-repo";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — takes a Postgres advisory lock. A null token is a normal
 * outcome ("someone else is already running"), not an error.
 */
export const acquireAdvisoryLockUseCase = createUseCase(
  {
    id: "acquire-advisory-lock",
    inputSchema: z.object({ key: z.number().int() }),
    outputSchema: z.object({ token: z.string().nullable() }),
  },
  async ({ success }, { key }) => success({ token: await acquireAdvisoryLockRepo({ db, key }) }),
);
