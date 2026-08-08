import { z } from "zod";
import { db } from "@/db";
import { SourceRegistryEntrySchema } from "@/repositories/source-registry/source-registry-schema";
import { getSourceRegistryRepo } from "@/repositories/source-registry/get-source-registry-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of getSourceRegistryRepo. */
export const getSourceRegistryUseCase = createUseCase(
  {
    id: "get-source-registry",
    inputSchema: z.object({ sourceIds: z.array(z.string()).optional() }),
    outputSchema: z.array(SourceRegistryEntrySchema),
  },
  async ({ success }, { sourceIds }) => success(await getSourceRegistryRepo({ db, sourceIds })),
);
