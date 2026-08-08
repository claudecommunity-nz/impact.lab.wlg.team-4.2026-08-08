/**
 * How each dataset is drawn. Deliberately literal hex rather than Tailwind
 * theme tokens: MapLibre paint properties are evaluated on the GPU and cannot
 * read CSS variables.
 *
 * The ponding colours are the publisher's own — the WCC layer ships its
 * symbology in a `Symbology` field ("Fill colour: #65C7EA. Outline colour:
 * #114CA8. Transparency: 30%") — so the map looks like the Council's own map of
 * the same data rather than a reinterpretation of it.
 */
/**
 * Point layers are told apart by SHAPE, not just colour. At the default zoom a
 * marker is a handful of pixels, and hubs and tanks — the two things someone
 * under pressure is most likely to be hunting for — were previously both small
 * circles separated only by hue. Shape survives being small, being glanced at,
 * and being looked at by someone with colour vision deficiency.
 */
export type MarkerShape = "circle" | "square";

export type LayerPaint = {
  /** Fill for polygons, marker fill for points. Also the fallback for `graded`. */
  fill: string;
  outline: string;
  opacity: number;
  /** Point layers only. Defaults to a circle when unset. */
  marker?: MarkerShape;
  /**
   * Optional: shade features by one of their own attributes instead of using a
   * flat fill — for layers where the class carries the meaning.
   */
  graded?: {
    property: string;
    /** Most severe first; the legend renders them in this order. */
    stops: { value: string | number; colour: string; label: string; title: string }[];
  };
};

export const LAYER_PAINT: Record<string, LayerPaint> = {
  // Hazard extents: cool colours, sitting underneath everything else.
  "ponding-areas": { fill: "#65C7EA", outline: "#114CA8", opacity: 0.7 },
  /*
   * Zone 1 is the shore exclusion zone and zone 3 the outermost, so the ramp
   * runs dark-to-light with severity. WCC publishes its own red/orange/yellow
   * for these; we stay in the layer's violet instead, because red and orange on
   * this map already mean "emergency hub" and would fight the response layers
   * for attention. Severity is carried by depth of colour, not by hue.
   */
  "tsunami-evacuation-zones": {
    fill: "#A78BFA",
    outline: "#5B21B6",
    opacity: 0.4,
    graded: {
      property: "Zone_Class",
      stops: [
        { value: 1, colour: "#6D28D9", label: "1", title: "Zone 1 — shore exclusion zone" },
        { value: 2, colour: "#A78BFA", label: "2", title: "Zone 2 — CDEM evacuation zone" },
        { value: 3, colour: "#DDD6FE", label: "3", title: "Zone 3 — self evacuation zone" },
      ],
    },
  },
  // Response infrastructure: warm and saturated, so it reads on top of hazard.
  "emergency-routes": { fill: "#22C55E", outline: "#14532D", opacity: 0.9 },
  // Square for the places you go to, circle for supplies. Square versus circle
  // reads at a glance and at a few pixels, which colour alone did not.
  "community-emergency-hubs": {
    fill: "#F59E0B",
    outline: "#7C2D12",
    opacity: 0.95,
    marker: "square",
  },
  // Magenta because every other candidate is taken: green is the routes,
  // violet the tsunami zones, and the old cyan was near enough to the ponding
  // blue underneath it that tanks disappeared into the layer they most often
  // sit on top of. Nothing else on the map is in the pink range.
  "emergency-water-tanks": {
    fill: "#EC4899",
    outline: "#831843",
    opacity: 0.95,
    marker: "circle",
  },
};

/**
 * The board's primary display: suburbs shaded by report volume. Bands are
 * relative to the busiest suburb at the moment shown (computed in
 * board-map-client), so the legend speaks in comparisons, not counts \u2014 the
 * exact number is on hover.
 */
LAYER_PAINT["impact-zones"] = {
  fill: "#3f7d6e",
  outline: "rgba(42,39,36,0.18)",
  opacity: 0.42,
  graded: {
    property: "band",
    stops: [
      {
        value: "hot",
        colour: "#c25a41",
        label: "heavy",
        title: "Around half or more of the busiest suburb's report volume",
      },
      {
        value: "warm",
        colour: "#d99a2b",
        label: "moderate",
        title: "A meaningful share of the busiest suburb's report volume",
      },
      {
        value: "mild",
        colour: "#3f7d6e",
        label: "light",
        title: "A few reports in this suburb",
      },
    ],
  },
};

export const FALLBACK_PAINT: LayerPaint = { fill: "#94A3B8", outline: "#334155", opacity: 0.6 };

export function paintFor(datasetId: string): LayerPaint {
  return LAYER_PAINT[datasetId] ?? FALLBACK_PAINT;
}
