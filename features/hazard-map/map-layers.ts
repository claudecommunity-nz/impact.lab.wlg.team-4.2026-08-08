/**
 * Which layers the map draws, in draw order — first is bottom-most.
 *
 * Hazard extents go underneath so the response infrastructure that matters in
 * an event (routes, hubs, tanks) is never buried by a polygon fill. Points last
 * so they stay clickable over everything else.
 *
 * These ids are checked against the router's dataset enum at the call site, so
 * a typo here is a type error rather than an empty layer.
 */
export const MAP_LAYER_IDS = [
  "tsunami-evacuation-zones",
  "ponding-areas",
  "emergency-routes",
  "community-emergency-hubs",
  "emergency-water-tanks",
] as const;
