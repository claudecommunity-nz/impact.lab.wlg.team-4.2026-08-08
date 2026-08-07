/**
 * Geographic helpers. Pure — no IO.
 *
 * Geography is a GATE, not a similarity bonus (design/primitives.md): "flooding
 * in Aro Valley" and "flooding in Petone" are ~0.95 similar and must always be
 * two bubbles. So this file exists to say NO, and to say it in metres a human
 * can check on a map.
 */

const EARTH_RADIUS_METRES = 6_371_000;

export type LatLng = { lat: number; lng: number };

/** Great-circle distance in metres. Wellington-scale, so the sphere is plenty. */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "400m" / "2.3km" — for the human-readable half of an edge's reason. */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)}m` : `${(metres / 1000).toFixed(1)}km`;
}

/** "12min" / "3.5h" — same job, other axis. */
export function formatDuration(milliseconds: number): string {
  const minutes = Math.abs(milliseconds) / 60_000;
  return minutes < 60 ? `${Math.round(minutes)}min` : `${(minutes / 60).toFixed(1)}h`;
}
