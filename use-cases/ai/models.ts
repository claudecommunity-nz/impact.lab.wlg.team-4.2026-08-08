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
