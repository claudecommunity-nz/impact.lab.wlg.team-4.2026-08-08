/**
 * Collect signals and write them to disk, without a browser or a running server.
 *
 * The use case is the unit of work — the tRPC procedure and this script are two
 * thin skins over the same call, which is the point of the architecture: the
 * demo path and the inspection path cannot drift apart.
 *
 *   npx tsx scripts/collect-signals.ts
 *   npx tsx scripts/collect-signals.ts --since 48 --out data/signals
 *
 * Output lands in `data/signals/` which is gitignored — it contains harvested
 * public posts and street-level fault reports, and this repo is public.
 */
import { collectSignalsUseCase } from "../use-cases/signals/collect-signals-use-case";
import { getLogger, LoggerModule } from "../utilities/logger";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const log = getLogger({ module: LoggerModule.Jobs });

  const since = flag("since");
  const outputDir = flag("out");

  const result = await collectSignalsUseCase({
    write: true,
    ...(since ? { sinceHours: Number(since) } : {}),
    ...(outputDir ? { outputDir } : {}),
    log,
  });

  if (result.error) {
    console.error("Collection failed:", result.error);
    process.exitCode = 1;
    return;
  }

  const { signals, sources, files, assessments } = result.data;

  // A per-source table, because "221 signals" hides the case that matters most:
  // one source quietly returning zero while the total still looks healthy.
  // `returned` is what the source handed over — social sources are then trimmed
  // to the time window, so the totals below will be lower.
  console.table(
    sources.map((source) => ({
      source: source.source,
      ok: source.ok,
      returned: source.count,
      note: source.error ?? "",
    })),
  );

  const located = signals.filter((signal) => signal.location !== null).length;
  const bands = assessments.reduce<Record<string, number>>(
    (acc, assessment) => {
      acc[assessment.band] = (acc[assessment.band] ?? 0) + 1;
      return acc;
    },
    {},
  );

  console.log(`\nsignals:   ${signals.length} (${located} with coordinates)`);
  console.log(`clusters:  ${JSON.stringify(bands)}`);
  console.log(`json:      ${files?.jsonPath ?? "not written"}`);
  console.log(`ndjson:    ${files?.ndjsonPath ?? "not written"}`);
}

void main();
