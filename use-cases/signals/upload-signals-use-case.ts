import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalUploadItemSchema } from "./signal-upload-schema";

/**
 * Thin INTEGRATION use case — one POST to the ingest endpoint, no logic.
 *
 * The endpoint is not yet defined, so it is read from SIGNALS_INGEST_URL rather
 * than hard-coded. Without it this returns an expected error (not a throw), so
 * collection still runs and can be inspected locally — the pipeline is never
 * blocked on a service that hasn't shipped.
 *
 * Every item carries `externalId`, so re-sending is safe by design; that is what
 * lets us retry a failed batch without polluting the corpus with duplicates.
 */
export const uploadSignalsUseCase = createUseCase(
  {
    id: "upload-signals",
    inputSchema: z.object({
      items: z.array(SignalUploadItemSchema),
      /** Override for replays/fixtures; defaults to the env endpoint. */
      endpoint: z.string().url().optional(),
    }),
    outputSchema: z.object({
      uploaded: z.number().int().min(0),
      endpoint: z.string(),
    }),
  },
  async ({ success, error }, { items, endpoint, log }) => {
    const target = endpoint ?? process.env.SIGNALS_INGEST_URL;

    if (!target) {
      return error({
        message:
          "No ingest endpoint configured. Set SIGNALS_INGEST_URL in .env.local, or pass `endpoint` explicitly.",
        itemCount: items.length,
      });
    }

    if (items.length === 0) {
      return success({ uploaded: 0, endpoint: target });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    // Optional bearer, only if the service ends up requiring one.
    if (process.env.SIGNALS_INGEST_TOKEN) {
      headers.authorization = `Bearer ${process.env.SIGNALS_INGEST_TOKEN}`;
    }

    const response = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return error({
        message: `Signal upload failed (${response.status})`,
        endpoint: target,
        body: body.slice(0, 300),
      });
    }

    log?.info({ uploaded: items.length, endpoint: target }, "Signals uploaded");
    return success({ uploaded: items.length, endpoint: target });
  },
);
