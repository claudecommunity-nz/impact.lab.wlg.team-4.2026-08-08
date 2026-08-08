"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl v6 has no default export — everything is a named import.
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type FillLayerSpecification,
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
import { paintFor, type MarkerShape } from "./layer-paint";

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

/**
 * ArcGIS bookkeeping columns — noise in a popup. Services vary in how they
 * spell these (`Shape_Length` on MapServer, `Shape__Length` on FeatureServer),
 * so both forms are listed rather than pattern-matched.
 */
const HIDDEN_PROPERTIES = new Set([
  "OBJECTID",
  "OBJECTID_1",
  "objectid",
  "FID",
  "Shape",
  "Shape_Length",
  "Shape_Leng",
  "Shape_Area",
  "Shape__Length",
  "Shape__Length_2",
  "Shape__Area",
  "X",
  "Y",
  // Cartography instructions for the publisher's own map, not facts about the
  // feature: "Fill colour: #65C7EA. Outline width: 1..." tells an analyst nothing.
  "Symbology",
  "Col_Code",
]);
const MAX_POPUP_ROWS = 8;

/** How far from the cursor counts as "here", in pixels. */
const CLICK_TOLERANCE = 6;

const sourceIdFor = (datasetId: string) => `gis-${datasetId}`;
const fillLayerIdFor = (datasetId: string) => `gis-${datasetId}-fill`;
const outlineLayerIdFor = (datasetId: string) => `gis-${datasetId}-outline`;
const circleLayerIdFor = (datasetId: string) => `gis-${datasetId}-circle`;
const lineLayerIdFor = (datasetId: string) => `gis-${datasetId}-line`;
const markerLayerIdFor = (datasetId: string) => `gis-${datasetId}-marker`;
const markerImageIdFor = (datasetId: string) => `marker-${datasetId}`;

/** One dataset can be more than one MapLibre layer — a polygon needs both. */
function styleLayerIdsFor(layer: MapLayer): string[] {
  switch (layer.geometryKind) {
    case "polygon":
      return [fillLayerIdFor(layer.datasetId), outlineLayerIdFor(layer.datasetId)];
    case "line":
      return [lineLayerIdFor(layer.datasetId)];
    default:
      return paintFor(layer.datasetId).marker
        ? [markerLayerIdFor(layer.datasetId)]
        : [circleLayerIdFor(layer.datasetId)];
  }
}

/**
 * The style layer that `layers[index]` must be inserted BEFORE to keep the
 * declared draw order, or undefined to append on top.
 *
 * Necessary because layers stream in: they are added in whatever order the
 * Council servers answer, not the order they are listed. Water tanks come back
 * in well under a second and ponding takes about seven, so appending would put
 * the ponding polygons on top of the markers — which is exactly what happened.
 * Inserting against the next layer that is already present keeps the stack
 * right no matter what order the responses arrive in.
 */
function insertBefore(map: MapLibreMap, layers: MapLayer[], index: number): string | undefined {
  for (let above = index + 1; above < layers.length; above++) {
    for (const styleLayerId of styleLayerIdsFor(layers[above])) {
      if (map.getLayer(styleLayerId)) return styleLayerId;
    }
  }
  return undefined;
}

/** The one layer per dataset that a click should hit. */
function clickTargetFor(layer: MapLayer): string {
  switch (layer.geometryKind) {
    case "polygon":
      return fillLayerIdFor(layer.datasetId);
    case "line":
      return lineLayerIdFor(layer.datasetId);
    default:
      return paintFor(layer.datasetId).marker
        ? markerLayerIdFor(layer.datasetId)
        : circleLayerIdFor(layer.datasetId);
  }
}

/**
 * Draws a marker to an offscreen canvas so MapLibre can use it as a symbol.
 *
 * Generated rather than shipped as image files: the shapes are simple, and this
 * keeps a layer's whole appearance — colour and form — in one registry entry
 * instead of split between code and an assets folder. It also means no glyph or
 * sprite server, which a hand-built style would otherwise need.
 */
function markerImage(shape: MarkerShape, fill: string, outline: string): ImageData | null {
  const size = 44;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const inset = 6;
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 4;
  ctx.beginPath();

  if (shape === "square") {
    ctx.roundRect(inset, inset, size - inset * 2, size - inset * 2, 8);
  } else {
    ctx.arc(size / 2, size / 2, size / 2 - inset, 0, Math.PI * 2);
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Renders a value as a link when it is one, and as text otherwise.
 *
 * Only http(s) survives: an href is the one place third-party data could become
 * executable (`javascript:`), and these values come from servers we don't own.
 * Anything that fails to parse, or parses to another scheme, falls back to
 * plain text — which can't do anything.
 *
 * The visible text is the host, not the URL: these are ePlan and ArcGIS item
 * links that run to 80+ characters and were the thing blowing the popup open.
 */
function valueNode(value: unknown): HTMLElement | Text {
  const text = String(value);
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = url.href;
        link.className = "text-primary underline underline-offset-2";
        link.textContent = `${url.host} ↗`;
        return link;
      }
    } catch {
      // Not a parseable URL — fall through to text.
    }
  }
  return document.createTextNode(text);
}

/** Everything one layer has at the clicked point. */
type FeatureGroup = { layer: MapLayer; properties: Record<string, unknown>[] };

/** One layer's section of the popup: name, caveat, and the feature's fields. */
function groupSection(group: FeatureGroup): HTMLElement {
  const section = document.createElement("section");
  section.className = "space-y-1";

  // Colours are named rather than inherited: the popup lives in MapLibre's own
  // chrome, outside anything that sets a foreground colour for us.
  const heading = document.createElement("p");
  heading.className = "text-xs font-semibold text-popover-foreground";
  heading.textContent = group.layer.displayName;
  section.append(heading);

  // Each layer carries its own limitation, and it belongs next to the values it
  // qualifies — a reader who only ever opens a popup still sees it.
  const caveat = document.createElement("p");
  caveat.className = "text-[11px] leading-snug text-muted-foreground";
  caveat.textContent = group.layer.caveat;
  section.append(caveat);

  const list = document.createElement("dl");
  list.className = "grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5";
  const rows = Object.entries(group.properties[0] ?? {})
    .filter(([key, value]) => !HIDDEN_PROPERTIES.has(key) && value !== null && value !== "")
    .slice(0, MAX_POPUP_ROWS);

  for (const [key, value] of rows) {
    const term = document.createElement("dt");
    term.className = "text-muted-foreground";
    term.textContent = key;
    const definition = document.createElement("dd");
    // min-w-0 is load-bearing: a grid item defaults to min-width:auto, so a long
    // unbroken value sets the track's minimum and the popup grows past its
    // max-width instead of wrapping. break-words alone can't prevent that.
    definition.className = "min-w-0 font-medium break-words text-popover-foreground";
    definition.append(valueNode(value));
    list.append(term, definition);
  }
  section.append(list);

  // Overlapping features within one layer are common (nested tsunami zones, a
  // route crossing itself). Say so rather than pretending the first is the only.
  if (group.properties.length > 1) {
    const more = document.createElement("p");
    more.className = "text-[11px] text-muted-foreground";
    more.textContent = `+${group.properties.length - 1} more from this layer here`;
    section.append(more);
  }

  return section;
}

/**
 * Popup content is built with createElement/textContent rather than innerHTML.
 * These values come from third-party servers and are rendered verbatim, so
 * escaping has to be structural — textContent cannot execute markup.
 *
 * Reports EVERY layer under the cursor, not just the topmost. The point of
 * stacking these layers is the overlaps — a hub inside a tsunami zone, a route
 * crossing a ponding area — and answering with only the top layer hides exactly
 * the thing the map was built to show.
 */
function popupContent(groups: FeatureGroup[]): HTMLElement {
  const root = document.createElement("div");
  // Tall popups scroll rather than run off the map; the width cap is here
  // because MapLibre's own maxWidth can't restrain a grid (see the dd above).
  root.className = "max-w-72 max-h-80 overflow-y-auto text-xs";

  if (groups.length > 1) {
    const summary = document.createElement("p");
    summary.className = "pb-1.5 text-[11px] font-medium text-muted-foreground";
    summary.textContent = `${groups.length} layers at this point`;
    root.append(summary);
  }

  groups.forEach((group, index) => {
    if (index > 0) {
      const rule = document.createElement("hr");
      rule.className = "my-2 border-border";
      root.append(rule);
    }
    root.append(groupSection(group));
  });

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

  // Clickable layers, in draw order, and what each one belongs to. Held in refs
  // so the single map-level click handler registered at mount always sees the
  // current set without being torn down and rebuilt every time a layer arrives.
  const clickTargetsRef = useRef<string[]>([]);
  const layerByTargetRef = useRef(new Map<string, MapLayer>());

  // The basemap at mount builds the initial style; later changes go through
  // setTiles below, which swaps tiles without discarding the data layers.
  const [initialBasemap] = useState(basemap);

  useEffect(() => {
    if (!containerRef.current) return;

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

    /** Layers present at this point, in draw order, ignoring hidden ones. */
    const groupsAt = (point: { x: number; y: number }): FeatureGroup[] => {
      const targets = clickTargetsRef.current.filter((id) => map.getLayer(id));
      if (targets.length === 0) return [];
      // A box rather than a bare point: a 2px line or a small marker is close to
      // unhittable otherwise. Hidden layers are excluded by MapLibre itself.
      const found = map.queryRenderedFeatures(
        [
          [point.x - CLICK_TOLERANCE, point.y - CLICK_TOLERANCE],
          [point.x + CLICK_TOLERANCE, point.y + CLICK_TOLERANCE],
        ],
        { layers: targets },
      );

      const byTarget = new Map<string, Record<string, unknown>[]>();
      for (const feature of found) {
        const list = byTarget.get(feature.layer.id) ?? [];
        list.push(feature.properties ?? {});
        byTarget.set(feature.layer.id, list);
      }

      // Ordered by the draw order, so the popup reads bottom-up the same way the
      // map is stacked rather than in whatever order the query returned.
      return targets.flatMap((target) => {
        const properties = byTarget.get(target);
        const layer = layerByTargetRef.current.get(target);
        return properties && layer ? [{ layer, properties }] : [];
      });
    };

    map.on("click", (event) => {
      const groups = groupsAt(event.point);
      if (groups.length === 0) {
        popupRef.current?.remove();
        return;
      }
      popupRef.current?.setLngLat(event.lngLat).setDOMContent(popupContent(groups)).addTo(map);
    });

    map.on("mousemove", (event) => {
      map.getCanvas().style.cursor = groupsAt(event.point).length > 0 ? "pointer" : "";
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
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

    // Refreshed before drawing so the click handler knows about a layer as soon
    // as the data arrives — getLayer() filters out any not yet on the map.
    clickTargetsRef.current = layers.map(clickTargetFor);
    layerByTargetRef.current = new Map(layers.map((layer) => [clickTargetFor(layer), layer]));

    const draw = () => {
      for (const [index, layer] of layers.entries()) {
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
        const before = insertBefore(map, layers, index);

        if (layer.geometryKind === "polygon") {
          // A `match` on one of the feature's own attributes, so severity is
          // shaded per polygon. Falls back to the flat fill for any value the
          // registry doesn't list — an unknown class shouldn't vanish.
          const fillColor = paint.graded
            ? [
                "match",
                ["get", paint.graded.property],
                ...paint.graded.stops.flatMap((stop) => [stop.value, stop.colour]),
                paint.fill,
              ]
            : paint.fill;

          map.addLayer(
            {
              id: fillLayerIdFor(layer.datasetId),
              type: "fill",
              source: sourceId,
              paint: {
                "fill-color": fillColor as NonNullable<
                  FillLayerSpecification["paint"]
                >["fill-color"],
                "fill-opacity": paint.opacity,
              },
            },
            before,
          );
          map.addLayer(
            {
              id: outlineLayerIdFor(layer.datasetId),
              type: "line",
              source: sourceId,
              paint: { "line-color": paint.outline, "line-width": 1.5 },
            },
            before,
          );
        } else if (layer.geometryKind === "line") {
          map.addLayer(
            {
              id: lineLayerIdFor(layer.datasetId),
              type: "line",
              source: sourceId,
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                // Thicker as you zoom in: a 2px line is close to unclickable, and
                // road-priority routes are only meaningful once you can see streets.
                "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 15, 4],
                "line-color": paint.fill,
                "line-opacity": paint.opacity,
              },
            },
            before,
          );
        } else if (paint.marker) {
          // A symbol layer with a generated icon, so the shape distinguishes the
          // layer. addImage must precede addLayer or the symbol renders blank.
          const imageId = markerImageIdFor(layer.datasetId);
          if (!map.hasImage(imageId)) {
            const image = markerImage(paint.marker, paint.fill, paint.outline);
            if (image) map.addImage(imageId, image, { pixelRatio: 2 });
          }
          map.addLayer(
            {
              id: markerLayerIdFor(layer.datasetId),
              type: "symbol",
              source: sourceId,
              layout: {
                "icon-image": imageId,
                // Markers must not be dropped where they crowd: a missing hub reads
                // as "no hub here", which is worse than an overlapping pair.
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 15, 0.7],
              },
            },
            before,
          );
        } else {
          map.addLayer(
            {
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
            },
            before,
          );
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

    // Apply straight away — every write is guarded by getLayer, so calling this
    // before the layers exist is a no-op rather than an error. Do NOT gate on
    // isStyleLoaded(): with five sources it reads false while tiles are still
    // settling, and `once("load")` never fires again once load has happened, so
    // the toggle would silently stop working. `once` here only covers the very
    // first paint, and is removed on cleanup so listeners can't accumulate.
    apply();
    map.once("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [layers, hiddenDatasetIds]);

  return <div ref={containerRef} className="h-full w-full" aria-label="Map of Wellington hazard layers" role="application" />;
}
