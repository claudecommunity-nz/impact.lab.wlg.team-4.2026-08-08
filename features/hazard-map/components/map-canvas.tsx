"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl v6 has no default export — everything is a named import.
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type RasterTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";
import {
  BASEMAP_ATTRIBUTION,
  WELLINGTON_CENTER,
  WELLINGTON_MAX_BOUNDS,
  WELLINGTON_ZOOM,
  basemapTiles,
} from "./basemap";
import { paintFor } from "./layer-paint";

const BASEMAP_SOURCE_ID = "basemap";

/**
 * Turbopack can't rewrite the `import.meta.url` worker path inside MapLibre's
 * pre-bundled dist, so we serve the worker from /public instead (copied there
 * by scripts/copy-maplibre-worker.mjs). Without this the worker fails to load
 * and vector layers never render — while raster tiles still do, which makes it
 * look like a data problem rather than a bundling one.
 *
 * Must be called before the first Map is constructed.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** ArcGIS bookkeeping columns — noise in a popup. */
const HIDDEN_PROPERTIES = new Set(["OBJECTID", "objectid", "Shape", "Shape_Length", "Shape_Area", "X", "Y"]);
const MAX_POPUP_ROWS = 8;

const sourceIdFor = (datasetId: string) => `gis-${datasetId}`;
const fillLayerIdFor = (datasetId: string) => `gis-${datasetId}-fill`;
const outlineLayerIdFor = (datasetId: string) => `gis-${datasetId}-outline`;
const circleLayerIdFor = (datasetId: string) => `gis-${datasetId}-circle`;

/** One dataset can be more than one MapLibre layer — a polygon needs both. */
function styleLayerIdsFor(layer: MapLayer): string[] {
  return layer.geometryKind === "polygon"
    ? [fillLayerIdFor(layer.datasetId), outlineLayerIdFor(layer.datasetId)]
    : [circleLayerIdFor(layer.datasetId)];
}

/**
 * Popup content is built with createElement/textContent rather than innerHTML.
 * These values come from third-party servers and are rendered verbatim, so
 * escaping has to be structural — textContent cannot execute markup.
 */
function popupContent(layer: MapLayer, properties: Record<string, unknown>): HTMLElement {
  const root = document.createElement("div");
  root.className = "max-w-72 space-y-1.5 text-xs";

  // Colours are named rather than inherited: the popup lives in MapLibre's own
  // chrome, outside anything that sets a foreground colour for us.
  const title = document.createElement("p");
  title.className = "text-sm font-semibold text-popover-foreground";
  title.textContent = layer.displayName;
  root.append(title);

  const authority = document.createElement("p");
  authority.className = "text-muted-foreground";
  authority.textContent = `Published by ${layer.authority}`;
  root.append(authority);

  // Each layer carries its own limitation, and it belongs next to the values it
  // qualifies — a reader who only ever opens a popup still sees it.
  const caveat = document.createElement("p");
  caveat.className = "text-[11px] leading-snug text-muted-foreground";
  caveat.textContent = layer.caveat;
  root.append(caveat);

  const list = document.createElement("dl");
  list.className = "grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pt-1";
  const rows = Object.entries(properties)
    .filter(([key, value]) => !HIDDEN_PROPERTIES.has(key) && value !== null && value !== "")
    .slice(0, MAX_POPUP_ROWS);

  for (const [key, value] of rows) {
    const term = document.createElement("dt");
    term.className = "text-muted-foreground";
    term.textContent = key;
    const definition = document.createElement("dd");
    definition.className = "font-medium break-words text-popover-foreground";
    definition.textContent = String(value);
    list.append(term, definition);
  }
  root.append(list);

  return root;
}

/**
 * Presentational: GeoJSON in, a map out. No hooks beyond the ones that own the
 * MapLibre instance, no fetching — the feature's -client file supplies the data.
 *
 * MapLibre touches `window` at construction, so this component is only ever
 * reached through a next/dynamic({ ssr: false }) import.
 */
export function MapCanvas({
  layers,
  basemap,
  hiddenDatasetIds,
}: {
  layers: MapLayer[];
  basemap: "light" | "dark";
  hiddenDatasetIds: ReadonlySet<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const wiredLayers = useRef(new Set<string>());

  // The basemap at mount builds the initial style; later changes go through
  // setTiles below, which swaps tiles without discarding the data layers.
  const [initialBasemap] = useState(basemap);

  useEffect(() => {
    if (!containerRef.current) return;
    const wired = wiredLayers.current; // captured for the cleanup, per the hooks lint rule

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          [BASEMAP_SOURCE_ID]: {
            type: "raster",
            tiles: basemapTiles(initialBasemap),
            tileSize: 256,
            attribution: BASEMAP_ATTRIBUTION,
          },
        },
        layers: [{ id: "basemap-tiles", type: "raster", source: BASEMAP_SOURCE_ID }],
      },
      center: WELLINGTON_CENTER,
      zoom: WELLINGTON_ZOOM,
      maxBounds: WELLINGTON_MAX_BOUNDS,
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    // `hazard-popup` scopes the theme overrides in globals.css to this popup —
    // MapLibre's own popup chrome is light-only and would otherwise stay white.
    popupRef.current = new Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "320px",
      className: "hazard-popup",
    });
    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      wired.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [initialBasemap]);

  // Theme swap: same map, different tiles.
  useEffect(() => {
    const source = mapRef.current?.getSource<RasterTileSource>(BASEMAP_SOURCE_ID);
    source?.setTiles(basemapTiles(basemap));
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      for (const layer of layers) {
        const sourceId = sourceIdFor(layer.datasetId);
        // Geometry is `unknown` through the tRPC boundary by design — it is
        // never inspected here, only handed to MapLibre.
        const data = layer.featureCollection as unknown as GeoJSON.FeatureCollection;

        const existing = map.getSource<GeoJSONSource>(sourceId);
        if (existing) {
          existing.setData(data);
          continue;
        }

        map.addSource(sourceId, { type: "geojson", data });
        const paint = paintFor(layer.datasetId);
        const clickTargets: string[] = [];

        if (layer.geometryKind === "polygon") {
          map.addLayer({
            id: fillLayerIdFor(layer.datasetId),
            type: "fill",
            source: sourceId,
            paint: { "fill-color": paint.fill, "fill-opacity": paint.opacity },
          });
          map.addLayer({
            id: outlineLayerIdFor(layer.datasetId),
            type: "line",
            source: sourceId,
            paint: { "line-color": paint.outline, "line-width": 1.5 },
          });
          clickTargets.push(fillLayerIdFor(layer.datasetId));
        } else {
          map.addLayer({
            id: circleLayerIdFor(layer.datasetId),
            type: "circle",
            source: sourceId,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 8],
              "circle-color": paint.fill,
              "circle-opacity": paint.opacity,
              "circle-stroke-color": paint.outline,
              "circle-stroke-width": 1,
            },
          });
          clickTargets.push(circleLayerIdFor(layer.datasetId));
        }

        for (const target of clickTargets) {
          if (wiredLayers.current.has(target)) continue;
          wiredLayers.current.add(target);

          map.on("click", target, (event) => {
            const feature = event.features?.[0];
            if (!feature || !popupRef.current) return;
            popupRef.current
              .setLngLat(event.lngLat)
              .setDOMContent(popupContent(layer, feature.properties ?? {}))
              .addTo(map);
          });
          map.on("mouseenter", target, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", target, () => (map.getCanvas().style.cursor = ""));
        }
      }
    };

    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [layers]);

  // Visibility is a layout property, not a rebuild: the source and its parsed
  // tiles stay put, so toggling a layer back on is instant and costs no refetch.
  // Declared after the effect that adds the layers so the "load" handlers run
  // in that order on first paint.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // A popup anchored to a feature that just disappeared is a lie about
      // what's on the map, so any visibility change closes it.
      popupRef.current?.remove();

      for (const layer of layers) {
        const visibility = hiddenDatasetIds.has(layer.datasetId) ? "none" : "visible";
        for (const styleLayerId of styleLayerIdsFor(layer)) {
          if (map.getLayer(styleLayerId)) {
            map.setLayoutProperty(styleLayerId, "visibility", visibility);
          }
        }
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [layers, hiddenDatasetIds]);

  return <div ref={containerRef} className="h-full w-full" aria-label="Map of Wellington hazard layers" role="application" />;
}
