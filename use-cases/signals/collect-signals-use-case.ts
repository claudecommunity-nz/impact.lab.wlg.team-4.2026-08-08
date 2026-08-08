import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { assessTrustUseCase } from "@/use-cases/trust/assess-trust-use-case";
import { SignalSchema, SourceKind } from "./signal-schema";
import { toSignalUploadItem } from "./signal-upload-schema";
import { fetchBlueskySignalsUseCase } from "./fetch-bluesky-signals-use-case";
import { fetchRedditSignalsUseCase } from "./fetch-reddit-signals-use-case";
import { fetchWaterFaultSignalsUseCase } from "./fetch-water-fault-signals-use-case";
import { fetchMetserviceSignalsUseCase } from "./fetch-metservice-signals-use-case";
import { fetchGeonetQuakeSignalsUseCase } from "./fetch-geonet-quake-signals-use-case";
import { fetchGeonetFeltSignalsUseCase } from "./fetch-geonet-felt-signals-use-case";
import { uploadSignalsUseCase } from "./upload-signals-use-case";
import { writeSignalsFileUseCase } from "./write-signals-file-use-case";

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
      /**
       * Write the batch to data/signals/ as JSON + NDJSON. ON by default — a
       * collection that leaves no artefact is hard to inspect and impossible to
       * feed onward. Pass `false` to skip (e.g. a read-only filesystem).
       */
      write: z.boolean().optional(),
      /** Output directory, relative to the project root. */
      outputDir: z.string().optional(),
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
      /** Paths written. Null only if writing was disabled or the write failed. */
      files: z
        .object({ jsonPath: z.string(), ndjsonPath: z.string() })
        .nullable(),
    }),
  },
  async (
    { success, error },
    { query, sinceHours, datasetId, upload, write, outputDir, log },
  ) => {
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
      {
        source: "geonet-quakes",
        run: () => fetchGeonetQuakeSignalsUseCase({ sinceHours: hours, log }),
      },
      {
        source: "geonet-felt-reports",
        run: () => fetchGeonetFeltSignalsUseCase({ log }),
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

    /**
     * Bluesky and Reddit have no usable time filter, so they return whatever the
     * API feels like — which meant a "last 6 hours" collection was quietly
     * mixing in three-day-old chatter. Apply the window here instead.
     *
     * Official alerts are deliberately exempt: a severe weather warning issued
     * four days ago may still be in force, and dropping it because it is old
     * would remove a live hazard from the picture. Recency is a property of
     * chatter, not of a standing warning.
     */
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const signals = Array.from(byId.values()).filter((signal) => {
      if (signal.sourceKind !== SourceKind.Social) return true;
      return new Date(signal.observedAt).getTime() >= cutoff;
    });

    if (signals.length === 0) {
      return error({
        message:
          "No signals collected — every source failed or returned nothing.",
        sources,
      });
    }

    const trust = await assessTrustUseCase({ signals, log });
    if (trust.error) return error(trust.error);

    /**
     * Map once. Both the upload and the file write must emit the SAME payload —
     * if they diverged, what we inspected on disk would no longer be what the
     * vector store received.
     */
    const items = signals.map((signal) =>
      // `synthetic` is false because these are genuinely collected. Fixtures
      // must set it true at the point of authoring.
      toSignalUploadItem(signal, { datasetId: dataset, synthetic: false }),
    );

    let uploaded = 0;
    if (upload) {
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

    let files: { jsonPath: string; ndjsonPath: string } | null = null;
    if (write !== false) {
      const writeResult = await writeSignalsFileUseCase({
        items,
        ...(outputDir ? { outputDir } : {}),
        log,
      });
      // Same reasoning as upload: a disk failure must not lose the collection.
      if (writeResult.error) {
        log?.error(
          { err: writeResult.error },
          "File write failed — returning collected signals anyway",
        );
      } else {
        files = {
          jsonPath: writeResult.data.jsonPath,
          ndjsonPath: writeResult.data.ndjsonPath,
        };
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
      files,
    });
  },
);
