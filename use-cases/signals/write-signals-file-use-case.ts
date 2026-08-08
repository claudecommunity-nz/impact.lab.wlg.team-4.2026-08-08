import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalUploadItemSchema } from "./signal-upload-schema";

/**
 * Thin INTEGRATION use case — writes a batch to disk, no logic.
 *
 * Two formats, because they serve different consumers:
 *
 *   - `.json`   — one envelope with metadata + items. Easy to open, diff and
 *                 eyeball. This is the one to read while building.
 *   - `.ndjson` — one upload item per line. The format bulk embedding
 *                 pipelines expect, and it streams: a vector-store loader can
 *                 read it line by line without holding the whole corpus in
 *                 memory.
 *
 * PRIVACY: signal text includes Wellington Water job descriptions, which are
 * derived from public reports about real addresses (street numbers stripped,
 * street and suburb retained). This repo is public and must stay free of
 * personal information, so output defaults to `data/signals/` which is
 * gitignored. Writes are confined to that directory — an absolute or
 * `../`-escaping path is rejected rather than honoured.
 */
export const writeSignalsFileUseCase = createUseCase(
  {
    id: "write-signals-file",
    inputSchema: z.object({
      items: z.array(SignalUploadItemSchema),
      /** Directory relative to the project root. */
      outputDir: z.string().optional(),
      /** Base filename without extension. Defaults to a UTC timestamp. */
      filename: z.string().optional(),
      /** Also write a `latest.*` copy, so scripts have a stable path. */
      writeLatest: z.boolean().optional(),
    }),
    outputSchema: z.object({
      jsonPath: z.string(),
      ndjsonPath: z.string(),
      itemCount: z.number().int().min(0),
    }),
  },
  async (
    { success, error },
    { items, outputDir, filename, writeLatest, log },
  ) => {
    const projectRoot = process.cwd();
    const targetDir = resolve(projectRoot, outputDir ?? "data/signals");

    // Never write outside the project — a traversal path is a bug, not a request.
    if (!targetDir.startsWith(projectRoot)) {
      return error({
        message: "Refusing to write outside the project directory.",
        outputDir,
      });
    }

    // Colons are illegal in filenames on Windows, so use a flat timestamp.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = filename ?? `signals-${stamp}`;

    const envelope = {
      generatedAt: new Date().toISOString(),
      itemCount: items.length,
      /**
       * Stated up front so a consumer cannot mistake this corpus for verified
       * fact. The same caveats also travel per-item in `annotations`.
       */
      provenance: {
        description:
          "Public signals collected from official feeds and social media for the Wellington Impact Lab prototype.",
        caveat:
          "Signals are unverified indicators for an intelligence team to investigate. Social media content is never confirmed fact. Not an operational emergency source — in an emergency, call 111.",
        sourceCounts: countBy(items, (item) =>
          String(item.source ?? "unknown"),
        ),
        sourceClassCounts: countBy(items, (item) =>
          String(item.sourceClass ?? "unknown"),
        ),
      },
      items,
    };

    await mkdir(targetDir, { recursive: true });

    const jsonPath = join(targetDir, `${base}.json`);
    const ndjsonPath = join(targetDir, `${base}.ndjson`);
    const ndjson = items.map((item) => JSON.stringify(item)).join("\n");

    await writeFile(jsonPath, JSON.stringify(envelope, null, 2), "utf8");
    await writeFile(ndjsonPath, ndjson ? `${ndjson}\n` : "", "utf8");

    if (writeLatest !== false) {
      await writeFile(
        join(targetDir, "latest.json"),
        JSON.stringify(envelope, null, 2),
        "utf8",
      );
      await writeFile(
        join(targetDir, "latest.ndjson"),
        ndjson ? `${ndjson}\n` : "",
        "utf8",
      );
    }

    log?.info(
      { jsonPath, ndjsonPath, itemCount: items.length },
      "Signals written to disk",
    );

    return success({ jsonPath, ndjsonPath, itemCount: items.length });
  },
);

function countBy<T>(
  items: T[],
  key: (item: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}
