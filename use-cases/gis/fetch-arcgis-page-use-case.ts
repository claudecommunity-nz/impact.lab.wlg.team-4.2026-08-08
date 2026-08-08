import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";
import { GisFeatureSchema } from "./map-layer-schema";

/** Council servers are shared and at least one throttles — fail rather than hang. */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Ask ArcGIS to generalise geometry server-side, in degrees of the output SR.
 * 0.0001° is roughly 10 m at Wellington's latitude.
 *
 * This is not a micro-optimisation: the WCC ponding layer takes ~80s and ~4 MB
 * to return its 17 full-detail polygons, and ~7s and ~1 MB generalised. The
 * cost is that outlines are approximate at street scale, which the UI states.
 */
const MAX_ALLOWABLE_OFFSET = "0.0001";

/** ~0.1 m — far finer than the generalisation above, just trims payload noise. */
const GEOMETRY_PRECISION = "6";

/** What an ArcGIS `f=geojson` response looks like, including its 200-with-error form. */
type ArcgisResponse = {
  features?: unknown[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
};

/**
 * Thin INTEGRATION use case — exactly ONE ArcGIS request, no logic. Paging
 * belongs to get-map-layer-use-case; this returns a single page and reports
 * whether the server had more to give.
 *
 * Two of the catalogue's documented traps are handled here, once, for every
 * caller: services publish NZTM2000 (so we always ask for `outSR=4326`, or pins
 * land off the coast of Africa), and a capped response is flagged only by
 * `exceededTransferLimit` — it otherwise looks like a complete answer.
 */
export const fetchArcgisPageUseCase = createUseCase(
  {
    id: "fetch-arcgis-page",
    inputSchema: z.object({
      layerUrl: z.url(),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      offset: z.number().int().min(0),
      pageSize: z.number().int().min(1).max(2000),
    }),
    outputSchema: z.object({
      features: z.array(GisFeatureSchema),
      exceededTransferLimit: z.boolean(),
    }),
  },
  async ({ success, error }, { layerUrl, bbox, offset, pageSize }) => {
    const [west, south, east, north] = bbox;
    const query = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      geometry: `${west},${south},${east},${north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
      returnGeometry: "true",
      maxAllowableOffset: MAX_ALLOWABLE_OFFSET,
      geometryPrecision: GEOMETRY_PRECISION,
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: "geojson",
    });

    const response = await fetch(`${layerUrl}/query?${query}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return error({
        message: `ArcGIS returned ${response.status} ${response.statusText}`,
        layerUrl,
        status: response.status,
      });
    }

    // ArcGIS reports failure with HTTP 200 and an { error } body.
    const payload = (await response.json()) as ArcgisResponse;
    if (payload.error) {
      return error({
        message: `ArcGIS error: ${payload.error.message ?? "no message given"}`,
        layerUrl,
      });
    }

    const parsed = z.array(GisFeatureSchema).safeParse(payload.features ?? []);
    if (!parsed.success) {
      return error({ message: "ArcGIS returned features in an unexpected shape", layerUrl });
    }

    return success({
      features: parsed.data,
      exceededTransferLimit: payload.exceededTransferLimit === true,
    });
  },
);
