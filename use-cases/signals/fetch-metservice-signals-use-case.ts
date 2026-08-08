import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { SignalSchema, SourceKind, LocationMethod } from "./signal-schema";
import { classifyHazard, WELLINGTON_BBOX } from "./signal-enrichment";
import { queryArcgisUseCase } from "./query-arcgis-use-case";

const LAYER_URL =
  "https://services.arcgis.com/XTtANUDT8Va4DLwI/arcgis/rest/services/Metservice_Weather_Alerts/FeatureServer/0";

/**
 * BUSINESS-LOGIC use case — composes the ArcGIS integration use case and maps
 * MetService CAP alerts into signals.
 *
 * These are the authoritative end of the reliability gradient, and they arrive
 * with real CAP fields — `info_certainty`, `info_severity`, `info_urgency` —
 * so we can express confidence using the publisher's own assessment rather than
 * inventing a number. When MetService says certainty is "Possible", we say
 * "Possible" too.
 *
 * Alerts are polygons over whole regions; the point we emit is a centroid, so
 * it is deliberately given lower location confidence than a street-level fault.
 */
export const fetchMetserviceSignalsUseCase = createUseCase(
  {
    id: "fetch-metservice-signals",
    inputSchema: z.object({
      /** Restrict to the Wellington envelope. Off = whole country. */
      wellingtonOnly: z.boolean().optional(),
    }),
    outputSchema: z.array(SignalSchema),
  },
  async ({ success, error }, { wellingtonOnly, log }) => {
    const result = await queryArcgisUseCase({
      layerUrl: LAYER_URL,
      where: "1=1",
      ...(wellingtonOnly === false ? {} : { bbox: WELLINGTON_BBOX }),
      log,
    });

    if (result.error) return error(result.error);

    const collectedAt = new Date();

    const signals = result.data.features.flatMap((feature) => {
      const f = feature as {
        geometry?: { type?: string; coordinates?: unknown };
        properties?: Record<string, unknown>;
      };

      const props = f.properties ?? {};
      const headline = String(props.info_headline ?? "Weather alert");
      const areaDesc = String(props.info_area_areaDesc ?? "");
      const description = String(props.info_description ?? "");
      const identifier = String(props.identifier ?? props.OBJECTID ?? headline);

      const centroid = polygonCentroid(f.geometry?.coordinates);
      const severity = String(props.info_severity ?? "unknown");
      const certainty = String(props.info_certainty ?? "unknown");
      const urgency = String(props.info_urgency ?? "unknown");

      const text = [headline, areaDesc, description]
        .filter(Boolean)
        .join(" — ");

      return [
        {
          id: `metservice:${identifier}`,
          externalId: identifier,
          source: "metservice-cap-alerts",
          sourceKind: SourceKind.Official,
          text: text.slice(0, 2000),
          observedAt: props.sent ? new Date(String(props.sent)) : collectedAt,
          collectedAt,
          location: centroid
            ? {
                lng: centroid[0],
                lat: centroid[1],
                // A regional polygon reduced to a point — useful for placement,
                // misleading if read as the location of an impact.
                confidence: 0.5,
                method: LocationMethod.Reprojected,
                matchedPlace: null,
                locationText: areaDesc || null,
              }
            : null,
          locationText: areaDesc || null,
          hazardType: classifyHazard(
            `${headline} ${String(props.info_event ?? "")}`,
          ),
          mediaType: "link" as const,
          url: String(props.info_web ?? "https://metservice.com/warnings/home"),
          mediaUrl: null,
          quotedUrls: [],
          authorRef: null,
          limitations: [
            `Official MetService alert. Severity: ${severity}; certainty: ${certainty}; urgency: ${urgency} (the publisher's own assessment).`,
            "Alert area is a region-wide polygon — the plotted point is its centroid, not the location of any specific impact.",
            "A forecast warning, not a report of an impact that has occurred.",
          ],
        },
      ];
    });

    log?.info({ kept: signals.length }, "MetService signals collected");
    return success(signals);
  },
);

/** Rough centroid: mean of a polygon's outer-ring vertices. Good enough to place a pin. */
function polygonCentroid(coordinates: unknown): [number, number] | null {
  if (!Array.isArray(coordinates)) return null;

  const points: Array<[number, number]> = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      points.push([node[0], node[1]]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(coordinates);

  if (points.length === 0) return null;
  const sum = points.reduce<[number, number]>(
    (acc, [x, y]) => [acc[0] + x, acc[1] + y],
    [0, 0],
  );
  return [sum[0] / points.length, sum[1] / points.length];
}
