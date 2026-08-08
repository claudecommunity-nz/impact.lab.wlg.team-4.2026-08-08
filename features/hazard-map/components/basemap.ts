/**
 * Esri's Light Gray Canvas — a cartographic base DESIGNED to sit under
 * overlays, which is exactly what both maps in this repo need.
 *
 * It replaced CARTO for a blunt reason as well as an aesthetic one: on the
 * venue network CARTO's tiles come back as 103-byte stubs with a 200 status,
 * and so do OpenStreetMap's — identical size across unrelated providers, which
 * is tile-CDN interception rather than any provider's fault. Esri is served
 * (verified: a real 2.4KB tile). The CARTO URLs are kept below, commented, in
 * case the network differs wherever this is finally demoed.
 *
 * ArcGIS orders its tile path {z}/{y}/{x} — y BEFORE x, the opposite of CARTO,
 * OSM and almost everything else. Swapping them silently serves tiles from the
 * wrong place rather than erroring.
 */

export const BASEMAP_ATTRIBUTION =
  "Esri, HERE, Garmin, © <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";

/** The ground: land, water and roads, with no place names on it. */
export function basemapTiles(theme: "light" | "dark"): string[] {
  const variant = theme === "dark" ? "World_Dark_Gray_Base" : "World_Light_Gray_Base";
  return [`${ESRI}/${variant}/MapServer/tile/{z}/{y}/{x}`];

  // CARTO fallback, if a network serves it:
  // const v = theme === "dark" ? "dark_all" : "light_all";
  // return ["a", "b", "c", "d"].map(
  //   (s) => `https://${s}.basemaps.cartocdn.com/rastertiles/${v}/{z}/{x}/{y}.png`,
  // );
}

/**
 * Place names, as a SEPARATE transparent layer. Esri splits them from the base
 * on purpose so overlays can be drawn between the two — geography underneath,
 * our signals on top, and the labels wherever they read best.
 */
export function basemapLabelTiles(theme: "light" | "dark"): string[] {
  const variant =
    theme === "dark" ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference";
  return [`${ESRI}/${variant}/MapServer/tile/{z}/{y}/{x}`];
}

/** Civic Square, near enough to the middle of the city for an opening view. */
export const WELLINGTON_CENTER: [number, number] = [174.7787, -41.2889];
export const WELLINGTON_ZOOM = 11.5;

/** Slightly looser than the data bbox so the edges of the region stay reachable. */
export const WELLINGTON_MAX_BOUNDS: [[number, number], [number, number]] = [
  [174.5, -41.45],
  [175.05, -41.05],
];
