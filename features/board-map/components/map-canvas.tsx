"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  AttributionControl,
  type GeoJSONSource,
  MapLibreMap,
  Marker,
  NavigationControl,
  type RasterTileSource,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { SignalFeature } from "@/components/board/api-types";
import { credibilityColour, gradeCode, gradeSentence } from "@/components/board/grade";
import {
  BASEMAP_ATTRIBUTION,
  WELLINGTON_CENTER,
  WELLINGTON_MAX_BOUNDS,
  WELLINGTON_ZOOM,
  basemapTiles,
} from "@/features/hazard-map/components/basemap";
import { paintFor } from "@/features/hazard-map/components/layer-paint";
import type { MapLayer } from "@/use-cases/gis/map-layer-schema";

const BASEMAP_SOURCE_ID = "basemap";
const HALO_LAYER_ID = "halo-fill";

/** Uncertainty is about WHERE, not about how credible — so the halo is one neutral hue. */
const HALO_COLOUR = "#8da0b5";

const EMPTY_COLLECTION = { type: "FeatureCollection" as const, features: [] };

/**
 * Turbopack cannot rewrite the `import.meta.url` worker path inside MapLibre's
 * pre-bundled dist, so the worker is served from /public instead (copied there
 * by scripts/copy-maplibre-worker.mjs, which runs on `prebuild`). Without this
 * the worker fails to load and every GeoJSON source — the hazard layers AND the
 * uncertainty circles — silently never renders, while raster tiles still do.
 *
 * `prebuild` does NOT run for `next dev`: run `node scripts/copy-maplibre-worker.mjs`
 * once after a fresh install if vector layers are missing in development.
 *
 * The hazard map calls this too; MapLibre keeps one global worker URL and both
 * want the same value.
 */
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

type MarkerRecord = {
  marker: Marker;
  element: HTMLButtonElement;
  dot: HTMLSpanElement;
  chip: HTMLSpanElement;
  flag: HTMLSpanElement;
};

/**
 * The board's single canvas: Council hazard geography underneath, our signal
 * clusters on top of it.
 *
 * The basemap, the region bounds and every hazard layer's paint come from
 * `features/hazard-map` rather than being restated here — the two maps in this
 * repo must not drift into two different Wellingtons.
 *
 * Hazard features are deliberately NOT clickable here, unlike on /map. On this
 * screen a click means "open this signal's evidence", and a second click target
 * underneath the first would make that gesture ambiguous. The hazard layers are
 * context for the signals; /map remains the place to interrogate them.
 *
 * Two rendering choices worth knowing:
 *
 *   - **Signals are DOM markers, not a circle layer.** A signal has to be
 *     reachable by keyboard and readable by a screen reader ("Aro Valley
 *     flooding, grade C3, 2 independent sources across 7 items"), and a canvas
 *     hit-test cannot be either.
 *   - **Inferred locations get a CIRCLE, not a pin.** `radiusM` is the distance
 *     from the averaged position to the furthest item that voted for it, drawn
 *     as a true ground-distance polygon so it stays honest at every zoom. A pin
 *     would claim a precision the evidence does not have.
 *
 * The camera is never moved by data. Polling every three seconds must not slide
 * the map out from under an operator mid-read.
 */
export function MapCanvas({
  features,
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
  features: SignalFeature[];
  layers: MapLayer[];
  hiddenDatasetIds: ReadonlySet<string>;
  basemap: "light" | "dark";
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef(new Map<string, MarkerRecord>());
  // The map lives in STATE, not a ref: the marker, hazard and halo effects have
  // to run the moment it exists, and a ref assignment does not re-render.
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [basemapDown, setBasemapDown] = useState(false);
  const [initialBasemap] = useState(basemap);

  // The click handler is bound once per marker, so it reads the latest callback
  // through a ref rather than being rebound on every poll.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markers = markersRef.current;

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
        },
        layers: [
          // Drawn under the tiles on purpose: if CARTO is unreachable — a
          // conference wifi is not a guarantee — the map degrades to a dark
          // field with the signals still on it, rather than to white voids.
          { id: "backdrop", type: "background", paint: { "background-color": "#0b1017" } },
          { id: "basemap-tiles", type: "raster", source: BASEMAP_SOURCE_ID },
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

    map.on("error", (event) => {
      // `sourceId` is present on tile-load failures but not on the base
      // ErrorEvent type, so it is read defensively rather than cast wholesale.
      if ((event as { sourceId?: string }).sourceId === BASEMAP_SOURCE_ID) setBasemapDown(true);
    });

    map.on("load", () => {
      // Added first so every hazard layer can be inserted BENEATH it later —
      // our evidence must never end up buried under a hazard polygon.
      map.addSource("signal-halos", { type: "geojson", data: EMPTY_COLLECTION });
      map.addLayer({
        id: HALO_LAYER_ID,
        type: "fill",
        source: "signal-halos",
        paint: { "fill-color": HALO_COLOUR, "fill-opacity": 0.09 },
      });
      map.addLayer({
        id: "halo-line",
        type: "line",
        source: "signal-halos",
        paint: {
          "line-color": HALO_COLOUR,
          "line-opacity": 0.5,
          "line-width": 1,
          "line-dasharray": [2, 2],
        },
      });
      setStyleReady(true);
    });

    setMapInstance(map);

    return () => {
      for (const record of markers.values()) record.marker.remove();
      markers.clear();
      map.remove();
      setMapInstance(null);
      setStyleReady(false);
    };
  }, [initialBasemap]);

  // Theme swap: same map, different tiles.
  useEffect(() => {
    mapInstance?.getSource<RasterTileSource>(BASEMAP_SOURCE_ID)?.setTiles(basemapTiles(basemap));
  }, [mapInstance, basemap]);

  // Council hazard geography, drawn beneath the signals.
  useEffect(() => {
    if (!mapInstance || !styleReady) return;

    for (const layer of layers) {
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
      const beneathSignals = mapInstance.getLayer(HALO_LAYER_ID) ? HALO_LAYER_ID : undefined;

      if (layer.geometryKind === "polygon") {
        mapInstance.addLayer(
          {
            id,
            type: "fill",
            source: sourceId,
            paint: { "fill-color": paint.fill, "fill-opacity": paint.opacity * 0.5 },
          },
          beneathSignals,
        );
        mapInstance.addLayer(
          {
            id: `${id}-outline`,
            type: "line",
            source: sourceId,
            paint: { "line-color": paint.outline, "line-width": 1, "line-opacity": 0.7 },
          },
          beneathSignals,
        );
      } else if (layer.geometryKind === "line") {
        mapInstance.addLayer(
          {
            id,
            type: "line",
            source: sourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 15, 4],
              "line-color": paint.fill,
              "line-opacity": paint.opacity * 0.8,
            },
          },
          beneathSignals,
        );
      } else {
        mapInstance.addLayer(
          {
            id,
            type: "circle",
            source: sourceId,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
              "circle-color": paint.fill,
              "circle-opacity": paint.opacity * 0.85,
              "circle-stroke-color": paint.outline,
              "circle-stroke-width": 1,
            },
          },
          beneathSignals,
        );
      }
    }
  }, [mapInstance, styleReady, layers]);

  // Hazard layer visibility, driven by the shared legend.
  useEffect(() => {
    if (!mapInstance || !styleReady) return;

    for (const layer of layers) {
      const visibility = hiddenDatasetIds.has(layer.datasetId) ? "none" : "visible";
      for (const id of [`hazard-layer-${layer.datasetId}`, `hazard-layer-${layer.datasetId}-outline`]) {
        if (mapInstance.getLayer(id)) mapInstance.setLayoutProperty(id, "visibility", visibility);
      }
    }
  }, [mapInstance, styleReady, layers, hiddenDatasetIds]);

  // Signals → markers. Diffed by signalId so a poll that changes nothing does
  // not tear down and rebuild the marker the operator is hovering.
  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    const seen = new Set<string>();

    for (const feature of features) {
      const id = feature.properties.signalId;
      seen.add(id);

      let record = markersRef.current.get(id);
      if (!record) {
        record = createMarkerRecord(() => onSelectRef.current(id));
        record.marker.setLngLat(feature.geometry.coordinates).addTo(map);
        markersRef.current.set(id, record);
      } else {
        record.marker.setLngLat(feature.geometry.coordinates);
      }

      paintMarker(record, feature, id === selectedSignalId);
    }

    for (const [id, record] of markersRef.current) {
      if (seen.has(id)) continue;
      record.marker.remove();
      markersRef.current.delete(id);
    }
  }, [mapInstance, features, selectedSignalId]);

  // Uncertainty circles are a GeoJSON source, so unlike the markers they DO have
  // to wait for the style to load — `addSource` before that throws.
  useEffect(() => {
    if (!mapInstance || !styleReady) return;

    const source = mapInstance.getSource<GeoJSONSource>("signal-halos");
    if (!source) return;

    source.setData({
      type: "FeatureCollection",
      features: features
        .filter((feature) => feature.properties.radiusM !== null)
        .map((feature) =>
          groundCircle(
            feature.geometry.coordinates,
            feature.properties.radiusM as number,
            feature.properties.signalId,
          ),
        ),
    });
  }, [mapInstance, styleReady, features]);

  return (
    <div className="absolute inset-0">
      {/* Sized with h-full/w-full, NOT `absolute inset-0`: maplibre-gl.css sets
          `.maplibregl-map { position: relative }` on whatever container it is
          given, which beats Tailwind's `absolute` and collapses the element to
          zero height — a blank pane with a healthy map object inside it. */}
      <div ref={containerRef} className="h-full w-full" />
      {basemapDown && (
        <p className="board-panel board-muted absolute top-3 left-3 z-10 rounded-md border px-2.5 py-1.5 font-mono text-[10px]">
          Basemap tiles unreachable — signals and geography are still positioned correctly.
        </p>
      )}
    </div>
  );
}

// ─── internals ────────────────────────────────────────────────────────────────

function createMarkerRecord(onClick: () => void): MarkerRecord {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "signal-marker";

  const dot = document.createElement("span");
  dot.className = "dot";

  const chip = document.createElement("span");
  chip.className = "chip";

  const flag = document.createElement("span");
  flag.className = "synthetic-flag";
  flag.textContent = "SYN";
  flag.hidden = true;

  element.append(dot, chip, flag);
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });

  // anchor:"left" puts the element's left edge on the coordinate; the offset
  // pulls it back by half a dot so the DOT sits on the point, not the chip.
  const marker = new Marker({ element, anchor: "left", offset: [-6, 0] });

  return { marker, element, dot, chip, flag };
}

function paintMarker(record: MarkerRecord, feature: SignalFeature, selected: boolean) {
  const properties = feature.properties;
  const colour = credibilityColour(properties.grade);
  const name = properties.label ?? "Unnamed signal";

  record.element.setAttribute("aria-pressed", selected ? "true" : "false");
  record.element.style.zIndex = selected ? "5" : "3";
  record.element.setAttribute(
    "aria-label",
    [
      name,
      properties.issueType ? `issue type ${properties.issueType.replace(/_/g, " ")}` : null,
      `grade ${gradeCode(properties.grade)} (${gradeSentence(properties.grade)})`,
      `${properties.independentSources} independent ${
        properties.independentSources === 1 ? "source" : "sources"
      } across ${properties.itemCount} ${properties.itemCount === 1 ? "item" : "items"}`,
      `location ${properties.locationCertainty}`,
      properties.syntheticContributor ? "includes synthetic demo content" : null,
    ]
      .filter(Boolean)
      .join(", "),
  );

  record.dot.style.background = colour;
  record.dot.classList.toggle("ungraded", properties.grade === null);
  record.dot.style.borderColor = properties.grade === null ? colour : "rgba(11,16,23,.9)";

  record.chip.textContent = gradeCode(properties.grade);
  record.chip.style.color = colour;
  record.chip.style.borderColor = `color-mix(in oklab, ${colour} 45%, transparent)`;

  record.flag.hidden = !properties.syntheticContributor;
}

/**
 * A circle of `radiusM` METRES on the ground, as a GeoJSON polygon.
 *
 * Drawn as real geography rather than a fixed pixel radius so that zooming in
 * on a 900m halo shows a 900m halo. The longitude term shrinks with latitude —
 * at Wellington's -41° a degree of longitude is about three quarters of a
 * degree of latitude, and ignoring that would draw a visibly squashed egg.
 */
function groundCircle(
  centre: [number, number],
  radiusM: number,
  signalId: string,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lng, lat] = centre;
  const latDegrees = radiusM / 111_320;
  const lngDegrees = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));

  const ring: [number, number][] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([lng + lngDegrees * Math.cos(angle), lat + latDegrees * Math.sin(angle)]);
  }

  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { signalId, radiusM },
  };
}
