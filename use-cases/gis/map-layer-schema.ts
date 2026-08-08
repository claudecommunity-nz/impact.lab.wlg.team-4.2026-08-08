import { z } from "zod";

/**
 * Geometry is passed through unvalidated: it comes straight from ArcGIS and
 * goes straight to MapLibre, and a full GeoJSON schema would cost far more than
 * it catches. Everything the UI must *display* is validated.
 */
export const GisFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: z.unknown(),
  properties: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * A map layer is a GeoJSON FeatureCollection plus the provenance the interface
 * is required to show. `truncated` is part of the payload for the same reason:
 * a partial layer that looks complete is exactly the kind of hidden limitation
 * this project is meant to surface.
 */
export const MapLayerSchema = z.object({
  datasetId: z.string(),
  displayName: z.string(),
  authority: z.string(),
  attribution: z.string(),
  geometryKind: z.enum(["point", "polygon", "line"]),
  /** This layer's own limitation — the map can't be honest with one blanket warning. */
  caveat: z.string(),
  fetchedAt: z.date(),
  /** True when we stopped paging at our own cap — the map is showing a subset. */
  truncated: z.boolean(),
  featureCollection: z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(GisFeatureSchema),
  }),
});

export type GisFeature = z.infer<typeof GisFeatureSchema>;
export type MapLayer = z.infer<typeof MapLayerSchema>;
