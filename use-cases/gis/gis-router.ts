import { z } from "zod";
import { router, publicProcedure } from "@/trpc/init";
import { callUseCase } from "@/utilities/call-use-case";
import { GIS_DATASET_IDS } from "./gis-datasets";
import { getMapLayerUseCase } from "./get-map-layer-use-case";
import { MapLayerSchema } from "./map-layer-schema";

/**
 * The GIS boundary. There is no repository layer here — the data lives on
 * Council ArcGIS servers, so the read goes through a use case rather than the
 * pure-fetch-wraps-one-repo-call form.
 */
export const gisRouter = router({
  layer: publicProcedure
    .input(z.object({ datasetId: z.enum(GIS_DATASET_IDS) }))
    .output(MapLayerSchema)
    .query(({ ctx, input }) => callUseCase(getMapLayerUseCase({ ...input, log: ctx.log }))),
});
