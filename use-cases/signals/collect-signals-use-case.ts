import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { assessTrustUseCase } from "@/use-cases/trust/assess-trust-use-case";
import { SignalSchema } from "./signal-schema";
import { toSignalUploadItem } from "./signal-upload-schema";
import { fetchBlueskySignalsUseCase } from "./fetch-bluesky-signals-use-case";
import { fetchRedditSignalsUseCase } from "./fetch-reddit-signals-use-case";
import { fetchWaterFaultSignalsUseCase } from "./fetch-water-fault-signals-use-case";
import { fetchMetserviceSignalsUseCase } from "./fetch-metservice-signals-use-case";
import { uploadSignalsUseCase } from "./upload-signals-use-case";

/**
 * BUSINESS-LOGIC use case — composes the collectors, the trust port and the
 * upload port. Composes use cases only; it never touches fetch or a repo.
 *
 * Collector failures are tolerated on purpose. A live demo that dies because one
 * council server is throttling is a worse outcome than a partial picture that
 * says which sources answered — so failures are recorded and surfaced rather
 * than thrown, and the UI can show "3 of 4 sources responded".
 */
export const collectSignalsUseCase = createUseCase(
  {
    id: "collect-signals",
    inputSchema: z.object({
      /** Search terms for the social collectors. */
      query: z.string().optional(),
      sinceHours: z.number().int().positive().optional(),
      /** "live" for real collection; anything else marks a replay/fixture set. */
      datasetId: z.string().optional(),
      /** POST the batch onward. Off by default so collection is always safe to run. */
      upload: z.boolean().optional(),
    }),
    outputSchema: z.object({
      signals: z.array(SignalSchema),
      assessments: z.array(
        z.object({
          signalId: z.string(),
          score: z.number(),
          band: z.string(),
          independentSourceCount: z.number(),
          corroboratingSignalIds: z.array(z.string()),
          reasons: z.array(z.string()),
          assessedBy: z.string(),
        }),
      ),
      sources: z.array(
        z.object({
          source: z.string(),
          ok: z.boolean(),
          count: z.number(),
          error: z.string().nullable(),
        }),
      ),
      uploaded: z.number(),
    }),
  },
  async ({ success, error }, { query, sinceHours, datasetId, upload, log }) => {
    const hours = sinceHours ?? 72;
    const dataset = datasetId ?? "live";

    /**
     * Bluesky's search ANDs every term — it has no OR operator, so a combined
     * query like "wellington flooding OR slip" matches nothing at all (verified:
     * it returns 0 while each phrase alone returns 20+). We therefore issue one
     * search per phrase and merge, rather than silently collecting nothing.
     */
    const blueskyQueries = query
      ? [query]
      : [
          "wellington flooding",
          "wellington slip",
          "wellington power outage",
          "wellington storm",
        ];

    const collectors = [
      ...blueskyQueries.map((q) => ({
        source: `bluesky-search:${q}`,
        run: () => fetchBlueskySignalsUseCase({ query: q, log }),
      })),
      {
        source: "reddit-r-wellington",
        run: () => fetchRedditSignalsUseCase({ subreddit: "Wellington", log }),
      },
      {
        source: "wellington-water-faults",
        run: () => fetchWaterFaultSignalsUseCase({ sinceHours: hours, log }),
      },
      {
        source: "metservice-cap-alerts",
        run: () => fetchMetserviceSignalsUseCase({ log }),
      },
    ];

    // Sources are independent, so run them together rather than in series.
    const results = await Promise.all(collectors.map((c) => c.run()));

    /**
     * Deduplicate by signal id. The several Bluesky phrase searches overlap, and
     * counting one post twice would fabricate corroboration — the exact failure
     * this prototype is meant to guard against.
     */
    const byId = new Map<string, z.infer<typeof SignalSchema>>();
    const sources = collectors.map((collector, index) => {
      const result = results[index];
      if (result.error) {
        log?.warn(
          { source: collector.source, err: result.error },
          "Collector failed",
        );
        return {
          source: collector.source,
          ok: false,
          count: 0,
          error: result.error.message,
        };
      }
      for (const signal of result.data) {
        if (!byId.has(signal.id)) byId.set(signal.id, signal);
      }
      return {
        source: collector.source,
        ok: true,
        count: result.data.length,
        error: null,
      };
    });

    const signals = Array.from(byId.values());

    if (signals.length === 0) {
      return error({
        message:
          "No signals collected — every source failed or returned nothing.",
        sources,
      });
    }

    const trust = await assessTrustUseCase({ signals, log });
    if (trust.error) return error(trust.error);

    let uploaded = 0;
    if (upload) {
      const items = signals.map((signal) =>
        // `synthetic` is false because these are genuinely collected. Fixtures
        // must set it true at the point of authoring.
        toSignalUploadItem(signal, { datasetId: dataset, synthetic: false }),
      );
      const uploadResult = await uploadSignalsUseCase({ items, log });
      // An upload failure must not discard the collection we just did.
      if (uploadResult.error) {
        log?.error(
          { err: uploadResult.error },
          "Upload failed — returning collected signals anyway",
        );
      } else {
        uploaded = uploadResult.data.uploaded;
      }
    }

    log?.info(
      { signals: signals.length, uploaded },
      "Signal collection complete",
    );

    return success({
      signals,
      assessments: trust.data.assessments,
      sources,
      uploaded,
    });
  },
);
