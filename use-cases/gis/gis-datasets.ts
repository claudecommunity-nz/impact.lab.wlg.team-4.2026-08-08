/**
 * The ONE place ArcGIS endpoints live — the GIS twin of `ai/models.ts`. Adding
 * a layer to the map is an entry here plus a paint rule in
 * `features/hazard-map/components/layer-paint.ts`; nothing else changes.
 *
 * Catalogue: https://claudecommunity-nz.github.io/wcc-emergency-gis-data/
 * A quarter of the catalogue's layers are rasters that advertise query support
 * and then refuse it — only add datasets with `feature_queryable: true`.
 */

/** The team SDK's Wellington box: west, south, east, north (WGS84). */
export const WELLINGTON_BBOX: readonly [number, number, number, number] = [
  174.62, -41.36, 174.94, -41.14,
];

export type GisDataset = {
  displayName: string;
  authority: string;
  /** Shown on the map, per the licence terms of each publisher. */
  attribution: string;
  geometryKind: "point" | "polygon" | "line";
  /**
   * What this specific layer does NOT tell you. Per-dataset because one blanket
   * warning would be wrong for at least one of them: a modelled planning extent
   * and an operational list of hub locations mislead in completely different
   * ways. Travels to the client so the legend and popup can show it.
   */
  caveat: string;
  /** ArcGIS Feature Layer root — `/query` is appended by the fetch use case. */
  layerUrl: string;
};

export const GIS_DATASETS = {
  "community-emergency-hubs": {
    displayName: "Community Emergency Hubs",
    authority: "Wellington Region Emergency Management Office",
    attribution: "Community Emergency Hubs © WREMO / Greater Wellington Regional Council",
    geometryKind: "point",
    caveat:
      "Operational locations published by WREMO. Whether a hub is open, staffed or reachable is not shown — this is the published list, not live status.",
    layerUrl: "https://mapping.gw.govt.nz/arcgis/rest/services/GW/Emergencies_P/MapServer/2",
  },
  "tsunami-evacuation-zones": {
    displayName: "Tsunami evacuation zones",
    authority: "Wellington City Council",
    attribution: "Tsunami Evacuation Zones © Wellington City Council",
    geometryKind: "polygon",
    caveat:
      "Planning zones based on modelled scenarios — not a prediction of any particular wave, and not an indication that one is expected.",
    layerUrl: "https://gis.wcc.govt.nz/arcgis/rest/services/Environment/TsunamiEvacuationZones/MapServer/1",
  },
  "emergency-routes": {
    displayName: "Post-quake emergency routes",
    authority: "Wellington City Council",
    attribution: "Post-Quake Emergency Routes © Wellington City Council",
    geometryKind: "line",
    caveat:
      "The planned order in which WCC intends to reopen roads after a major quake. Not current road status — a route shown here may be blocked.",
    layerUrl:
      "https://services1.arcgis.com/CPYspmTk3abe6d7i/arcgis/rest/services/Emergency_Routes/FeatureServer/0",
  },
  "emergency-water-tanks": {
    displayName: "Emergency water tanks",
    authority: "Wellington City Council",
    attribution: "Emergency Water Tank Locations © Wellington City Council",
    geometryKind: "point",
    caveat:
      "Published tank locations. Presence here says nothing about whether a tank is full, working or reachable after an event.",
    layerUrl:
      "https://services1.arcgis.com/CPYspmTk3abe6d7i/arcgis/rest/services/Emergency_Water_Tank_Location/FeatureServer/0",
  },
  "ponding-areas": {
    displayName: "Ponding inundation areas",
    authority: "Wellington City Council",
    attribution:
      "Ponding Inundation Area, Proposed District Plan © Wellington City Council / Wellington Water / GWRC",
    geometryKind: "polygon",
    caveat:
      "Modelled planning-stage extent from the Proposed District Plan — not observed flooding, and not a record of any current event.",
    layerUrl:
      "https://gis.wcc.govt.nz/arcgis/rest/services/DistrictPlanProposed/DistrictPlanProposed/MapServer/52",
  },
  "suburb-boundaries": {
    displayName: "Suburb boundaries",
    authority: "Wellington City Council",
    attribution: "Suburb boundaries © Wellington City Council",
    geometryKind: "polygon",
    caveat:
      "Administrative boundaries only. The impact-zone shading derived from them aggregates report counts by suburb — absence of reports is absence of information, not absence of impact.",
    layerUrl:
      "https://gis.wcc.govt.nz/arcgis/rest/services/PropertyAndBoundaries/WCC_Boundaries/MapServer/2",
  },
} as const satisfies Record<string, GisDataset>;

export type GisDatasetId = keyof typeof GIS_DATASETS;

/** Tuple form so `z.enum` can constrain the procedure input to real datasets. */
export const GIS_DATASET_IDS = Object.keys(GIS_DATASETS) as [GisDatasetId, ...GisDatasetId[]];
