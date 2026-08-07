/**
 * The ONLY place model ids live. Plain strings route through Vercel AI Gateway
 * (AI_GATEWAY_API_KEY) — no provider packages needed.
 */
export const MODELS = {
  /** High-volume / low-stakes calls. */
  fast: "anthropic/claude-haiku-4.5",
  /** User-facing generation worth a stronger model. */
  smart: "anthropic/claude-sonnet-4.5",
  /** 1536 dimensions. */
  embed: "openai/text-embedding-3-small",
} as const;

/**
 * The width of `MODELS.embed`. The offline stub matches it exactly so nothing
 * downstream — centroids, cosine, the PCA basis — can tell the two apart by shape.
 */
export const EMBED_DIMENSIONS = 1536;

/**
 * How much of a stub vector is the shared background direction (0–1).
 *
 * Real embedding spaces are anisotropic: every vector carries a big common
 * component, so cosine similarities live in a high, narrow band rather than
 * around zero. Calibrated against scripts/fixtures.json so that the SAME join
 * threshold separates "two reports of one event" from "two unrelated reports"
 * on both the stub and the real model. Retune only with measurements.
 *
 * At 0.65 the fixture set partitions correctly (13 flooding / 11 wind / 1 loner)
 * for every threshold from 0.70 to 0.80 — a plateau, not a knife edge, which is
 * the property worth having.
 */
export const EMBED_ANISOTROPY = 0.65;
