/**
 * CARTO raster basemaps — no API key, so there is nothing to configure on the
 * day. Attribution is a licence condition, not decoration: it is baked into the
 * source below rather than left to the caller to remember.
 *
 * MapLibre only substitutes {z}/{x}/{y} (and {bbox-epsg-3857}) in a tile URL —
 * Leaflet's {r} retina placeholder is not supported and would 404.
 */

export const BASEMAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
  '© <a href="https://carto.com/attributions">CARTO</a>';

const SUBDOMAINS = ["a", "b", "c", "d"];

export function basemapTiles(theme: "light" | "dark"): string[] {
  // Positron (light_all): a near-neutral paper ground. Voyager's greens and
  // blues compete with the signal bubbles drawn on top of it.
  const variant = theme === "dark" ? "dark_all" : "light_all";
  return SUBDOMAINS.map(
    (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/${variant}/{z}/{x}/{y}.png`,
  );
}

/** Civic Square, near enough to the middle of the city for an opening view. */
export const WELLINGTON_CENTER: [number, number] = [174.7787, -41.2889];
export const WELLINGTON_ZOOM = 11.5;

/** Slightly looser than the data bbox so the edges of the region stay reachable. */
export const WELLINGTON_MAX_BOUNDS: [[number, number], [number, number]] = [
  [174.5, -41.45],
  [175.05, -41.05],
];
