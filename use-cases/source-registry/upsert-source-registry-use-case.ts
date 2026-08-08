import { z } from "zod";
import { db } from "@/db";
import { SOURCE_RELIABILITY } from "@/db/vocabulary";
import { SourceRegistryEntrySchema } from "@/repositories/source-registry/source-registry-schema";
import { upsertSourceRegistryRepo } from "@/repositories/source-registry/upsert-source-registry-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of upsertSourceRegistryRepo. */
export const upsertSourceRegistryUseCase = createUseCase(
  {
    id: "upsert-source-registry",
    inputSchema: z.object({
      entries: z.array(
        z.object({
          sourceId: z.string().min(1),
          name: z.string().min(1),
          reliability: z.enum(SOURCE_RELIABILITY),
          kind: z.string().min(1),
          notes: z.string().nullable().optional(),
        }),
      ),
    }),
    outputSchema: z.array(SourceRegistryEntrySchema),
  },
  async ({ success }, { entries }) => success(await upsertSourceRegistryRepo({ db, entries })),
);
