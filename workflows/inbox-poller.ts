import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { sleep } from "workflow";
import { ingestBatchUseCase } from "@/use-cases/signals/ingest-batch-use-case";
import { LoggerModule, getLogger } from "@/utilities/logger";

/**
 * The PULL half of the universal intake: a drop folder.
 *
 * Not every team can call an API on the day — some have a scraper writing JSON
 * files, or a CSV export they can convert. Dropping a file into `data/inbox/`
 * is a complete integration. The file goes through the SAME adapter and the
 * SAME ingest use cases as the push path, then moves to `processed/` (or
 * `failed/`, with a reason logged) so the folder is always its own status board.
 *
 * A bad file must never stop the loop.
 */

const INBOX_DIR = path.join(process.cwd(), "data", "inbox");
const PROCESSED_DIR = path.join(INBOX_DIR, "processed");
const FAILED_DIR = path.join(INBOX_DIR, "failed");

export type InboxRoundSummary = {
  files: number;
  created: number;
  deduped: number;
  failed: number;
};

export async function inboxPollerWorkflow(input?: { rounds?: number; intervalSeconds?: number }) {
  "use workflow";

  const rounds = input?.rounds ?? 240;
  const intervalSeconds = input?.intervalSeconds ?? 15;

  const totals: InboxRoundSummary = { files: 0, created: 0, deduped: 0, failed: 0 };

  for (let round = 0; round < rounds; round += 1) {
    const summary = await pollInboxOnce();
    totals.files += summary.files;
    totals.created += summary.created;
    totals.deduped += summary.deduped;
    totals.failed += summary.failed;
    await sleep(`${intervalSeconds}s`); // suspends without consuming compute
  }

  return totals;
}

/**
 * One sweep of the drop folder. Every file is handled in its own try/catch:
 * the loop reports and moves on, it never throws.
 */
export async function pollInboxOnce(): Promise<InboxRoundSummary> {
  "use step";

  const log = getLogger({ module: LoggerModule.Jobs });
  const summary: InboxRoundSummary = { files: 0, created: 0, deduped: 0, failed: 0 };

  await mkdir(INBOX_DIR, { recursive: true });
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(FAILED_DIR, { recursive: true });

  const entries = await readdir(INBOX_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
    .map((e) => e.name)
    .sort();

  for (const name of files) {
    const filePath = path.join(INBOX_DIR, name);
    summary.files += 1;

    try {
      const contents = await readFile(filePath, "utf8");
      const items = readItems(contents);

      const result = await ingestBatchUseCase({ items, log });
      if (result.error) {
        log.error({ file: name, error: result.error.message }, "Inbox file failed to ingest");
        await moveTo(FAILED_DIR, filePath, name);
        summary.failed += items.length;
        continue;
      }

      const { created, deduped, failed } = result.data;
      summary.created += created;
      summary.deduped += deduped;
      summary.failed += failed;

      // Nothing landed at all → the file is wrong, not just partly wrong.
      const destination = created + deduped === 0 && failed > 0 ? FAILED_DIR : PROCESSED_DIR;
      await moveTo(destination, filePath, name);

      log.info(
        { file: name, created, deduped, failed, destination: path.basename(destination) },
        "Inbox file processed",
      );
    } catch (err) {
      log.error({ file: name, err }, "Inbox file could not be read — moving to failed/");
      summary.failed += 1;
      await moveTo(FAILED_DIR, filePath, name).catch((moveErr) => {
        log.error({ file: name, err: moveErr }, "Inbox file could not be moved");
      });
    }
  }

  return summary;
}

/**
 * Accepts the three shapes a drop file sensibly takes: a bare array of payloads,
 * `{ items: [...] }`, or a single payload object. Anything else is one item and
 * the adapter decides.
 */
function readItems(contents: string): unknown[] {
  const parsed: unknown = JSON.parse(contents);
  if (Array.isArray(parsed)) return parsed;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { items?: unknown }).items)
  ) {
    return (parsed as { items: unknown[] }).items;
  }
  return [parsed];
}

/** Timestamp-prefixed so re-dropping the same filename never overwrites history. */
async function moveTo(dir: string, filePath: string, name: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await rename(filePath, path.join(dir, `${stamp}-${name}`));
}
