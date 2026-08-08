import { z } from "zod";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin INTEGRATION use case — exactly one ArcGIS REST call, no logic.
 *
 * This is the ONLY place ArcGIS is called, which is what makes the projection
 * trap impossible to fall into: `outSR: 4326` is hard-coded, not a parameter.
 *
 * Publishers here serve NZTM2000 (wkid 2193) by default — WCC's layers do, and
 * requesting them raw puts every pin in the Atlantic off West Africa. ArcGIS
 * will reproject server-side, so we ask it to, every time. GNS ShakingLayers is
 * already WGS84; asking for 4326 is a no-op there rather than a second code path.
 *
 * `exceededTransferLimit` is returned rather than swallowed: at least one WCC
 * layer silently caps a response (footpaths has 8,130 features but returns
 * 2,000), and a caller that doesn't know it was truncated will draw a wrong map.
 */
export const queryArcgisUseCase = createUseCase(
  {
    id: "query-arcgis",
    inputSchema: z.object({
      /** Full layer URL, e.g. https://host/arcgis/rest/services/X/FeatureServer/0 */
      layerUrl: z.string().url(),
      where: z.string().optional(),
      /** Optional lng/lat envelope: [west, south, east, north]. */
      bbox: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional(),
      outFields: z.string().optional(),
      resultRecordCount: z.number().int().positive().max(2000).optional(),
      resultOffset: z.number().int().min(0).optional(),
    }),
    outputSchema: z.object({
      /** GeoJSON features, guaranteed WGS84 lng/lat. */
      features: z.array(z.record(z.string(), z.unknown())),
      exceededTransferLimit: z.boolean(),
    }),
  },
  async (
    { success, error },
    { layerUrl, where, bbox, outFields, resultRecordCount, resultOffset, log },
  ) => {
    const params = new URLSearchParams({
      where: where ?? "1=1",
      outFields: outFields ?? "*",
      returnGeometry: "true",
      // Non-negotiable: publishers default to NZTM2000, we always want lng/lat.
      outSR: "4326",
      f: "geojson",
    });

    if (bbox) {
      params.set("geometry", bbox.join(","));
      params.set("geometryType", "esriGeometryEnvelope");
      // The bbox we send is lng/lat too, so declare it.
      params.set("inSR", "4326");
      params.set("spatialRel", "esriSpatialRelIntersects");
    }
    if (resultRecordCount !== undefined)
      params.set("resultRecordCount", String(resultRecordCount));
    if (resultOffset !== undefined)
      params.set("resultOffset", String(resultOffset));

    const url = `${layerUrl.replace(/\/$/, "")}/query?${params.toString()}`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return error({
        message: `ArcGIS query failed (${response.status})`,
        layerUrl,
      });
    }

    const body = await response.json();

    // ArcGIS reports failures with HTTP 200 and an error body.
    if (body?.error) {
      return error({
        message: `ArcGIS error: ${body.error.message ?? "unknown"}`,
        layerUrl,
      });
    }

    const features = Array.isArray(body?.features) ? body.features : [];
    log?.info({ layerUrl, count: features.length }, "ArcGIS layer queried");

    return success({
      features,
      exceededTransferLimit:
        body?.exceededTransferLimit === true ||
        body?.properties?.exceededTransferLimit === true,
    });
  },
);
