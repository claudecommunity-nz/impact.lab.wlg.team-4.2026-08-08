import { z } from "zod";
import { ASSUMED_OCCURRED_AT_KEY } from "@/db/vocabulary";
import { createUseCase } from "@/utilities/create-use-case";
import { genericJsonAdapter } from "@/workflows/adapters/generic-json-adapter";
import { createSignalUseCase } from "./create-signal-use-case";
import { getSignalByDedupeUseCase } from "./get-signal-by-dedupe-use-case";

/** What every ingest path returns — an echo of what we understood, plus the id. */
export const IngestSignalResultSchema = z.object({
  id: z.uuid(),
  /** false = this payload matched an existing signal and was NOT stored again. */
  created: z.boolean(),
  /** The honest sentence we derived — check this if a payload reads oddly. */
  text: z.string(),
  source: z.string(),
  sourceClass: z.string(),
  occurredAt: z.date(),
  /** True when occurred_at was absent and defaulted to ingest time. */
  assumedOccurredAt: z.boolean(),
  /** The annotation keys we kept from the payload. */
  annotationKeys: z.array(z.string()),
});

export type IngestSignalResult = z.infer<typeof IngestSignalResultSchema>;

/**
 * The universal intake — the single entry point for BOTH the push path (tRPC
 * `signals.ingest`) and the pull path (the inbox poller). Everything that
 * enters the system enters here.
 *
 * The business logic:
 *   1. an adapter turns ANY payload into an honest sentence + feed annotations
 *      (it never throws — a payload we cannot read is a reported failure);
 *   2. occurred_at is optional: absent means now, and we SAY SO by writing an
 *      `assumed_occurred_at` annotation rather than silently inventing a time;
 *   3. dedupe on source + text + occurred_at, so re-delivery never inflates a
 *      bubble's mass;
 *   4. write the signal and its annotations in one transaction.
 */
export const ingestSignalUseCase = createUseCase(
  {
    id: "ingest-signal",
    inputSchema: z.object({
      /** ANY JSON payload — shape is the adapter's problem, not the sender's. */
      payload: z.unknown(),
    }),
    outputSchema: IngestSignalResultSchema,
  },
  async ({ success, error }, { payload, log }) => {
    const adapted = genericJsonAdapter(payload);
    if (!adapted.ok) {
      log?.warn({ reason: adapted.reason }, "Ingest rejected: payload could not be adapted");
      return error({ message: adapted.reason, kind: "adapter_rejected" });
    }

    const incoming = adapted.signal;
    const assumedOccurredAt = incoming.occurredAt === undefined;
    const occurredAt = incoming.occurredAt ?? new Date();

    const existing = await getSignalByDedupeUseCase({
      source: incoming.source,
      text: incoming.text,
      occurredAt,
      log,
    });
    if (existing.error) return error(existing.error);

    if (existing.data) {
      log?.info({ signalId: existing.data.id }, "Ingest deduped: signal already stored");
      return success({
        id: existing.data.id,
        created: false,
        text: existing.data.text,
        source: existing.data.source,
        sourceClass: existing.data.sourceClass,
        occurredAt: existing.data.occurredAt,
        assumedOccurredAt,
        annotationKeys: incoming.annotations.map((a) => a.key),
      });
    }

    // Say what we assumed, in the same open vocabulary as everything else.
    const annotations = assumedOccurredAt
      ? [
          ...incoming.annotations,
          { key: ASSUMED_OCCURRED_AT_KEY, value: "true", annotator: "rule" as const },
        ]
      : incoming.annotations;

    const created = await createSignalUseCase({
      source: incoming.source,
      sourceClass: incoming.sourceClass,
      text: incoming.text,
      occurredAt,
      raw: incoming.raw,
      lat: incoming.lat,
      lng: incoming.lng,
      geoConfidence: incoming.geoConfidence,
      annotations,
      log,
    });
    if (created.error) return error(created.error);

    log?.info(
      {
        signalId: created.data.signal.id,
        sourceClass: incoming.sourceClass,
        assumedOccurredAt,
        annotationCount: annotations.length,
        geolocated: incoming.lat !== undefined && incoming.lng !== undefined,
      },
      "Ingest stored a new signal",
    );

    return success({
      id: created.data.signal.id,
      created: true,
      text: created.data.signal.text,
      source: created.data.signal.source,
      sourceClass: created.data.signal.sourceClass,
      occurredAt: created.data.signal.occurredAt,
      assumedOccurredAt,
      annotationKeys: created.data.annotations.map((a) => a.key),
    });
  },
);
