"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  AttributionControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  MapLibreMap,
  NavigationControl,
  type RasterTileSource,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  BASEMAP_ATTRIBUTION,
  WELLINGTON_CENTER,
  WELLINGTON_MAX_BOUNDS,
  WELLINGTON_ZOOM,
  basemapLabelTiles,
  basemapTiles,
} from "@/features/hazard-map/components/basemap";
import { paintFor } from "@/features/hazard-map/components/layer-paint";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";

const BASEMAP_SOURCE_ID = "basemap";
const LABELS_SOURCE_ID = "basemap-labels";
const LABELS_LAYER_ID = "basemap-labels";

const ZONES_SOURCE_ID = "impact-zones";
const ZONES_FILL_ID = "impact-zones-fill";
const ZONES_OUTLINE_ID = "impact-zones-outline";

/**
 * Hazard geography is CONTEXT, not content.
 *
 * These layers are Council polygons covering most of the city; drawn at the
 * strength /map uses they win on sheer area and the impact picture disappears
 * into them. An operator is here to read the reports, so the geography sits
 * back to roughly a tenth of its natural weight — present enough to place a
 * suburb in a ponding basin or a tsunami zone, quiet enough that the shaded
 * suburbs are what the eye lands on.
 */
const HAZARD_FILL_OPACITY = 0.12;

const EMPTY_COLLECTION = { type: "FeatureCollection" as const, features: [] };

/**
 * The colour behind the tiles, per theme. MapLibre paint properties are
 * evaluated on the GPU and cannot read CSS variables, so these are the one
 * place the palette has to be restated as literals — kept in step with
 * --background in globals.css.
 */
const BACKDROP: Record<"light" | "dark", string> = {
  light: "#f7f5f2",
  dark: "#1c1a18",
};

/**
 * Turbopack cannot rewrite the `import.meta.url` worker path inside MapLibre's
 * pre-bundled dist, so the worker is served from /public instead (copied there
 * by scripts/copy-maplibre-worker.mjs, which runs on `prebuild`). Without this
 * the worker fails to load and every GeoJSON source — the hazard layers AND the
 * impact zones — silently never renders, while raster tiles still do.
 *
 * `prebuild` does NOT run for `next dev`: run `node scripts/copy-maplibre-worker.mjs`
 * once after a fresh install if vector layers are missing in development.
 *
 * The hazard map calls this too; MapLibre keeps one global worker URL and both
 * want the same value.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** Band colours restated as a GPU expression, from the one paint registry. */
function bandColourExpression(): ExpressionSpecification {
  const paint = paintFor("impact-zones");
  const stops = paint.graded?.stops ?? [];
  return [
    "match",
    ["get", "band"],
    ...stops.flatMap((stop) => [stop.value, stop.colour]),
    paint.fill,
  ] as unknown as ExpressionSpecification;
}

/**
 * The board's single canvas: Council hazard geography underneath, the impact
 * picture — WCC suburbs shaded by report volume — on top of it.
 *
 * The basemap, the region bounds and every hazard layer's paint come from
 * `features/hazard-map` rather than being restated here — the two maps in this
 * repo must not drift into two different Wellingtons.
 *
 * Suburb FILLS are the display, not dots. Size-scaled cluster markers with
 * uncertainty rings were built first and rejected: circles over polygon layers
 * read as clutter, and Council communicates in suburb names anyway. The suburb
 * is the unit an operator says out loud, so the suburb is the thing that lights
 * up. Hovering names it with its report count; clicking opens the evidence for
 * the busiest cluster inside it.
 *
 * Hazard features are deliberately NOT clickable here, unlike on /map. On this
 * screen a click means "open this suburb's evidence", and a second click target
 * underneath the first would make that gesture ambiguous. The hazard layers are
 * context for the zones; /map remains the place to interrogate them.
 *
 * The camera is never moved by data. Polling every three seconds must not slide
 * the map out from under an operator mid-read.
 */
export function MapCanvas({
  // Defaulted rather than merely typed as required: during a hot reload the
  // browser can briefly hold a module whose props do not match the one that
  // rendered it, and `for (const layer of undefined)` there would throw inside
  // an effect and take the scene down. Types cannot protect a running page from
  // its own stale chunk.
  layers = [],
  hiddenDatasetIds,
  basemap,
  selectedSignalId,
  onSelect,
}: {
  layers: MapLayer[];
  hiddenDatasetIds: ReadonlySet<string>;
  basemap: "light" | "dark";
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The map lives in STATE, not a ref: the zone and hazard effects have to run
  // the moment it exists, and a ref assignment does not re-render.
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [basemapDown, setBasemapDown] = useState(false);
  const [initialBasemap] = useState(basemap);

  // The suburb under the pointer, for the hover pill. Position is in container
  // pixels so the pill rides with the cursor.
  const [hoverZone, setHoverZone] = useState<{
    x: number;
    y: number;
    suburb: string;
    mass: number;
  } | null>(null);
  const hoveredZoneIdRef = useRef<number | string | null>(null);

  // The click handler is bound once when the zone layer is created, so it reads
  // the latest callback through a ref rather than being rebound on every poll.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new MapLibreMap({
      container,
      style: {
        version: 8,
        sources: {
          [BASEMAP_SOURCE_ID]: {
            type: "raster",
            tiles: basemapTiles(initialBasemap),
            tileSize: 256,
            attribution: BASEMAP_ATTRIBUTION,
          },
          // Place names ship separately from the ground so overlays can go
          // between them. Ours do not: the labels stay on top, because an
          // operator naming a suburb out loud matters more than a zone
          // polygon's edge being unbroken.
          [LABELS_SOURCE_ID]: {
            type: "raster",
            tiles: basemapLabelTiles(initialBasemap),
            tileSize: 256,
          },
        },
        layers: [
          // Drawn under the tiles on purpose: if the tile CDN is unreachable —
          // a conference wifi is not a guarantee — the map degrades to the
          // page's own paper colour with the zones still on it, rather than to
          // white voids or, worse, a black rectangle in a light interface.
          {
            id: "backdrop",
            type: "background",
            paint: { "background-color": BACKDROP[initialBasemap] },
          },
          { id: "basemap-tiles", type: "raster", source: BASEMAP_SOURCE_ID },
          {
            id: "basemap-labels",
            type: "raster",
            source: LABELS_SOURCE_ID,
            paint: { "raster-opacity": 0.9 },
          },
        ],
      },
      center: WELLINGTON_CENTER,
      zoom: WELLINGTON_ZOOM,
      maxBounds: WELLINGTON_MAX_BOUNDS,
      attributionControl: false,
    });

    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    // A stubbed tile CDN answers 200 with a tiny placeholder, so MapLibre never
    // raises an error and the map just looks empty. Sample one tile and judge it
    // by size — under a kilobyte is not a map.
    void fetch(basemapTiles(initialBasemap)[0].replace("{z}/{y}/{x}", "12/2530/4028"))
      .then((response) => response.blob())
      .then((blob) => {
        if (blob.size < 1024) setBasemapDown(true);
      })
      .catch(() => setBasemapDown(true));

    map.on("error", (event) => {
      // `sourceId` is present on tile-load failures but not on the base
      // ErrorEvent type, so it is read defensively rather than cast wholesale.
      if ((event as { sourceId?: string }).sourceId === BASEMAP_SOURCE_ID) setBasemapDown(true);
    });

    map.on("load", () => setStyleReady(true));

    setMapInstance(map);

    return () => {
      map.remove();
      setMapInstance(null);
      setStyleReady(false);
    };
  }, [initialBasemap]);

  // Theme swap: same map, different tiles.
  useEffect(() => {
    mapInstance?.getSource<RasterTileSource>(BASEMAP_SOURCE_ID)?.setTiles(basemapTiles(basemap));
    mapInstance
      ?.getSource<RasterTileSource>(LABELS_SOURCE_ID)
      ?.setTiles(basemapLabelTiles(basemap));
  }, [mapInstance, basemap]);

  // The impact picture: suburb polygons shaded by report volume, hoverable and
  // clickable. Created once, then updated in place so a poll or a scrub step
  // recolours the suburbs instead of tearing the layer down under the pointer.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !styleReady) return;

    const zones = layers.find((layer) => layer.datasetId === "impact-zones");
    const data = (zones?.featureCollection ??
      EMPTY_COLLECTION) as unknown as GeoJSON.FeatureCollection;

    const existing = map.getSource<GeoJSONSource>(ZONES_SOURCE_ID);
    if (existing) {
      // generateId reassigns feature ids on setData, so the held hover state
      // would point at the wrong suburb — drop it; the next mousemove re-arms.
      hoveredZoneIdRef.current = null;
      existing.setData(data);
      return;
    }
    if (!zones) return;

    map.addSource(ZONES_SOURCE_ID, { type: "geojson", data, generateId: true });

    const colour = bandColourExpression();
    const beneathLabels = map.getLayer(LABELS_LAYER_ID) ? LABELS_LAYER_ID : undefined;

    map.addLayer(
      {
        id: ZONES_FILL_ID,
        type: "fill",
        source: ZONES_SOURCE_ID,
        paint: {
          "fill-color": colour,
          // Weight follows the band — a heavy suburb is nearly solid, a mild
          // one is a wash — and the suburb under the pointer answers back with
          // an extra step of the same hue. Opacity carries hierarchy here;
          // uniform fills painted the whole city one flat tone.
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            ["match", ["get", "band"], "hot", 0.72, "warm", 0.56, 0.34],
            ["match", ["get", "band"], "hot", 0.55, "warm", 0.4, 0.18],
          ] as unknown as ExpressionSpecification,
        },
      },
      beneathLabels,
    );
    map.addLayer(
      {
        id: ZONES_OUTLINE_ID,
        type: "line",
        source: ZONES_SOURCE_ID,
        paint: {
          "line-color": colour,
          "line-width": 1,
          "line-opacity": [
            "match",
            ["get", "band"],
            "hot",
            0.7,
            "warm",
            0.5,
            0.25,
          ] as unknown as ExpressionSpecification,
        },
      },
      beneathLabels,
    );

    map.on("mousemove", ZONES_FILL_ID, (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";
      if (hoveredZoneIdRef.current !== null && hoveredZoneIdRef.current !== feature.id) {
        map.setFeatureState(
          { source: ZONES_SOURCE_ID, id: hoveredZoneIdRef.current },
          { hover: false },
        );
      }
      if (feature.id !== undefined) {
        hoveredZoneIdRef.current = feature.id;
        map.setFeatureState({ source: ZONES_SOURCE_ID, id: feature.id }, { hover: true });
      }
      const properties = feature.properties as { suburb?: string; mass?: number };
      setHoverZone({
        x: event.point.x,
        y: event.point.y,
        suburb: properties.suburb || "Unnamed area",
        mass: properties.mass ?? 0,
      });
    });

    map.on("mouseleave", ZONES_FILL_ID, () => {
      map.getCanvas().style.cursor = "";
      if (hoveredZoneIdRef.current !== null) {
        map.setFeatureState(
          { source: ZONES_SOURCE_ID, id: hoveredZoneIdRef.current },
          { hover: false },
        );
        hoveredZoneIdRef.current = null;
      }
      setHoverZone(null);
    });

    // A suburb click opens the evidence for the busiest cluster inside it —
    // the drill panel carries on from there.
    map.on("click", ZONES_FILL_ID, (event: MapLayerMouseEvent) => {
      const topSignalId = (event.features?.[0]?.properties as { topSignalId?: string } | undefined)
        ?.topSignalId;
      if (topSignalId) onSelectRef.current(topSignalId);
    });
  }, [mapInstance, styleReady, layers]);

  // The suburb holding the selected signal gets a firmer edge. `signalIds` is
  // an array property on each zone, so membership is testable on the GPU.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !styleReady || !map.getLayer(ZONES_OUTLINE_ID)) return;

    const holdsSelection = [
      "in",
      selectedSignalId ?? " none",
      ["get", "signalIds"],
    ] as unknown as ExpressionSpecification;
    map.setPaintProperty(ZONES_OUTLINE_ID, "line-width", [
      "case",
      holdsSelection,
      2.5,
      1,
    ] as unknown as ExpressionSpecification);
    map.setPaintProperty(ZONES_OUTLINE_ID, "line-opacity", [
      "case",
      holdsSelection,
      0.95,
      ["match", ["get", "band"], "hot", 0.7, "warm", 0.5, 0.25],
    ] as unknown as ExpressionSpecification);
  }, [mapInstance, styleReady, layers, selectedSignalId]);

  // Council hazard geography, drawn beneath the impact zones.
  useEffect(() => {
    if (!mapInstance || !styleReady) return;

    for (const layer of layers) {
      if (layer.datasetId === "impact-zones") continue; // drawn above, interactively

      const sourceId = `hazard-${layer.datasetId}`;
      // Geometry is `unknown` through the tRPC boundary by design — it is never
      // inspected here, only handed to MapLibre.
      const data = layer.featureCollection as unknown as GeoJSON.FeatureCollection;

      const existing = mapInstance.getSource<GeoJSONSource>(sourceId);
      if (existing) {
        existing.setData(data);
        continue;
      }

      mapInstance.addSource(sourceId, { type: "geojson", data });
      const paint = paintFor(layer.datasetId);
      const id = `hazard-layer-${layer.datasetId}`;
      // Beneath the zones when they exist, beneath the place names regardless.
      const beneathZones = mapInstance.getLayer(ZONES_FILL_ID)
        ? ZONES_FILL_ID
        : mapInstance.getLayer(LABELS_LAYER_ID)
          ? LABELS_LAYER_ID
          : undefined;

      if (layer.geometryKind === "polygon") {
        mapInstance.addLayer(
          {
            id,
            type: "fill",
            source: sourceId,
            paint: { "fill-color": paint.fill, "fill-opacity": HAZARD_FILL_OPACITY },
          },
          beneathZones,
        );
        mapInstance.addLayer(
          {
            id: `${id}-outline`,
            type: "line",
            source: sourceId,
            paint: { "line-color": paint.outline, "line-width": 0.6, "line-opacity": 0.35 },
          },
          beneathZones,
        );
      } else if (layer.geometryKind === "line") {
        mapInstance.addLayer(
          {
            id,
            type: "line",
            source: sourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 2],
              "line-color": paint.fill,
              "line-opacity": 0.3,
            },
          },
          beneathZones,
        );
      } else {
        mapInstance.addLayer(
          {
            id,
            type: "circle",
            source: sourceId,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 4],
              "circle-color": paint.fill,
              "circle-opacity": 0.32,
              "circle-stroke-color": paint.outline,
              "circle-stroke-width": 0.5,
            },
          },
          beneathZones,
        );
      }
    }
  }, [mapInstance, styleReady, layers]);

  // Layer visibility, driven by the shared legend. The impact zones live in
  // their own pair of layers; hazard layers follow the hazard-layer-* naming.
  useEffect(() => {
    if (!mapInstance || !styleReady) return;

    for (const layer of layers) {
      const visibility = hiddenDatasetIds.has(layer.datasetId) ? "none" : "visible";
      const ids =
        layer.datasetId === "impact-zones"
          ? [ZONES_FILL_ID, ZONES_OUTLINE_ID]
          : [`hazard-layer-${layer.datasetId}`, `hazard-layer-${layer.datasetId}-outline`];
      for (const id of ids) {
        if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, "visibility", visibility);
      }
    }
  }, [mapInstance, styleReady, layers, hiddenDatasetIds]);

  return (
    <div className="absolute inset-0">
      {/* Sized with h-full/w-full, NOT `absolute inset-0`: maplibre-gl.css sets
          `.maplibregl-map { position: relative }` on whatever container it is
          given, which beats Tailwind's `absolute` and collapses the element to
          zero height — a blank pane with a healthy map object inside it. */}
      <div ref={containerRef} className="h-full w-full" />
      {hoverZone && (
        <div
          className="bg-card border-border pointer-events-none absolute z-10 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shadow-sm"
          style={{ left: hoverZone.x + 14, top: hoverZone.y + 14 }}
        >
          {hoverZone.suburb} · {hoverZone.mass} {hoverZone.mass === 1 ? "report" : "reports"}
        </div>
      )}
      {basemapDown && (
        <p className="bg-card border-border text-muted-foreground absolute top-3 left-3 z-10 rounded-lg border px-2.5 py-1.5 text-[11px] shadow-sm">
          Map tiles are being blocked on this network — every suburb below is still shaded correctly.
        </p>
      )}
    </div>
  );
}
