import { createUseCase } from "@/utilities/create-use-case";
import { z } from "zod";
import { fetchArcgisPageUseCase } from "./fetch-arcgis-page-use-case";
import { GIS_DATASET_IDS, GIS_DATASETS, WELLINGTON_BBOX } from "./gis-datasets";
import { MapLayerSchema, type GisFeature } from "./map-layer-schema";

/** ArcGIS layers commonly cap at 2000 per request; ask for exactly that. */
const PAGE_SIZE = 2000;

/**
 * Our own ceiling, so one enormous layer can't stall a four-minute demo. When
 * we stop here the layer is reported as `truncated` rather than quietly short.
 */
const MAX_FEATURES = 10_000;

/**
 * Business-logic use case — composes the thin integration use case and owns the
 * only logic involved: paging. It never calls `fetch` itself.
 */
export const getMapLayerUseCase = createUseCase(
  {
    id: "get-map-layer",
    inputSchema: z.object({ datasetId: z.enum(GIS_DATASET_IDS) }),
    outputSchema: MapLayerSchema,
  },
  async ({ success, error }, { datasetId, log }) => {
    const dataset = GIS_DATASETS[datasetId];
    const features: GisFeature[] = [];
    let truncated = false;

    for (;;) {
      const page = await fetchArcgisPageUseCase({
        layerUrl: dataset.layerUrl,
        bbox: [...WELLINGTON_BBOX],
        offset: features.length,
        pageSize: PAGE_SIZE,
        log,
      });
      if (page.error) return error(page.error);

      features.push(...page.data.features);

      // The server only admits to holding back via exceededTransferLimit; an
      // empty page also ends the walk, so a lying flag can't spin forever.
      const serverHasMore = page.data.exceededTransferLimit && page.data.features.length > 0;
      if (!serverHasMore) break;
      if (features.length >= MAX_FEATURES) {
        truncated = true;
        break;
      }
    }

    log?.info({ datasetId, featureCount: features.length, truncated }, "Fetched GIS layer");

    return success({
      datasetId,
      displayName: dataset.displayName,
      authority: dataset.authority,
      attribution: dataset.attribution,
      geometryKind: dataset.geometryKind,
      caveat: dataset.caveat,
      fetchedAt: new Date(),
      truncated,
      featureCollection: { type: "FeatureCollection" as const, features },
    });
  },
);
