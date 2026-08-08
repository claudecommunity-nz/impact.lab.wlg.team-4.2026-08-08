import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema, SourceKind, LocationMethod } from "./signal-schema";
import { isInWellington } from "./signal-enrichment";

/**
 * Thin INTEGRATION use case — one call to GeoNet's reported-intensity API.
 *
 * This is the single most on-point source for Problem 03. Felt reports are
 * members of the public saying "I felt that", collected and published through
 * an official agency API: unverified in substance, authoritative in provenance.
 * They sit exactly in the middle of the reliability gradient the brief asks us
 * to make visible, and they corroborate instrument data from a completely
 * independent direction — people, not seismometers.
 *
 * Coordinates are native WGS84, aggregated by GeoNet onto a coarse grid.
 * Individual reporters are never exposed, which is why there is no author to
 * pseudonymise here.
 */
export const fetchGeonetFeltSignalsUseCase = createUseCase(
  {
    id: "fetch-geonet-felt-signals",
    inputSchema: z.object({
      /** Restrict to the Wellington envelope. Off = all of New Zealand. */
      wellingtonOnly: z.boolean().optional(),
      /** Optional quake id to fetch felt reports for one specific event. */
      publicId: z.string().optional(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, error }, { wellingtonOnly, publicId, log }) => {
    const url = new URL("https://api.geonet.org.nz/intensity");
    url.searchParams.set("type", "reported");
    if (publicId) url.searchParams.set("publicID", publicId);

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      return error({
        message: `GeoNet intensity API failed (${response.status})`,
      });
    }

    const body = await response.json();
    const features: unknown[] = Array.isArray(body?.features)
      ? body.features
      : [];
    const collectedAt = new Date();

    const signals = features.flatMap((raw) => {
      const feature = raw as {
        geometry?: { coordinates?: [number, number] };
        properties?: { mmi?: number; count?: number };
      };

      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return [];

      const [lng, lat] = coords;
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return [];
      if (wellingtonOnly !== false && !isInWellington(lng, lat)) return [];

      const mmi = feature.properties?.mmi ?? 0;
      const count = feature.properties?.count ?? 1;

      /**
       * Composed for embedding — the API returns only numbers. MMI is mapped to
       * its published descriptive band so the text carries meaning a vector
       * store can match against phrases like "shaking felt indoors".
       */
      const text =
        `${count} public report${count === 1 ? "" : "s"} of feeling earthquake shaking here. ` +
        `Reported intensity MMI ${mmi} (${describeMmi(mmi)}).`;

      /**
       * GeoNet's aggregate endpoint carries no per-report id or timestamp, so a
       * stable id is derived from the grid cell. Rounding to 3dp (~100 m) keeps
       * repeated polls idempotent instead of duplicating the same cell.
       */
      const cellId = `${lng.toFixed(3)},${lat.toFixed(3)}`;
      const externalId = publicId ? `${publicId}:${cellId}` : `felt:${cellId}`;

      return [
        {
          id: `geonet-felt:${externalId}`,
          externalId,
          source: "geonet-felt-reports",
          // Public reports, officially collected — the middle of the gradient.
          sourceKind: SourceKind.OfficialCrowd,
          text,
          // Composed from mmi/count — GeoNet publishes no report text.
          textGenerated: true,
          // No per-report timestamp is published; collection time is the best
          // available, and that is declared as a limitation rather than hidden.
          observedAt: collectedAt,
          collectedAt,
          location: {
            lng,
            lat,
            // Aggregated to a grid cell, not a reporter's exact position.
            confidence: 0.7,
            method: LocationMethod.Exact,
            matchedPlace: null,
            locationText: null,
          },
          locationText: null,
          hazardType: "earthquake" as const,
          mediaType: "none" as const,
          url: publicId
            ? `https://www.geonet.org.nz/earthquake/${publicId}`
            : null,
          mediaUrl: null,
          quotedUrls: [],
          authorRef: null,
          limitations: [
            "Public 'felt it' reports collected by GeoNet — unverified individual observations, officially aggregated.",
            "Locations are aggregated to a grid cell; individual reporters are not identified.",
            "GeoNet does not publish a per-report timestamp on this endpoint, so collection time is used.",
            `Report density reflects where people are, not where shaking was strongest — ${count} report(s) here.`,
            "Description text is composed from GeoNet's structured fields, not written by a person.",
          ],
        },
      ];
    });

    log?.info({ kept: signals.length }, "GeoNet felt-report signals collected");
    return success(signals);
  },
);

/** MMI → the descriptive band GeoNet publishes, so embedded text carries meaning. */
function describeMmi(mmi: number): string {
  if (mmi <= 2) return "unnoticeable";
  if (mmi === 3) return "weak, felt indoors";
  if (mmi === 4) return "light, felt by many indoors";
  if (mmi === 5) return "moderate, felt by nearly everyone";
  if (mmi === 6) return "strong, some damage possible";
  if (mmi === 7) return "severe, damage likely";
  return "extreme";
}
