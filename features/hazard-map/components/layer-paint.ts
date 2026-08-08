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
export type LayerPaint = {
  /** Fill for polygons, marker fill for points. */
  fill: string;
  outline: string;
  opacity: number;
};

export const LAYER_PAINT: Record<string, LayerPaint> = {
  // Hazard extents: cool colours, sitting underneath everything else.
  "ponding-areas": { fill: "#65C7EA", outline: "#114CA8", opacity: 0.7 },
  "tsunami-evacuation-zones": { fill: "#A78BFA", outline: "#5B21B6", opacity: 0.35 },
  // Response infrastructure: warm and saturated, so it reads on top of hazard.
  "emergency-routes": { fill: "#22C55E", outline: "#14532D", opacity: 0.9 },
  "community-emergency-hubs": { fill: "#F59E0B", outline: "#7C2D12", opacity: 0.95 },
  "emergency-water-tanks": { fill: "#06B6D4", outline: "#164E63", opacity: 0.95 },
};

/** Anything added to the dataset registry without a paint rule still renders. */
export const FALLBACK_PAINT: LayerPaint = { fill: "#94A3B8", outline: "#334155", opacity: 0.6 };

export function paintFor(datasetId: string): LayerPaint {
  return LAYER_PAINT[datasetId] ?? FALLBACK_PAINT;
}
