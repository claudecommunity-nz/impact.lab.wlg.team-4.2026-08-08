import { EMBED_ANISOTROPY, EMBED_DIMENSIONS } from "./models";

/**
 * The offline twin of the embedding model.
 *
 * `AI_GATEWAY_API_KEY` is not always set (it isn't on a hackathon laptop before
 * someone pastes the key in), and a vector layer that cannot run without a
 * network call is a vector layer that cannot be demoed. So this produces a
 * DETERMINISTIC vector of the same width, behind the same interface: same text
 * in, byte-identical vector out, forever, with no IO.
 *
 * It is a hashing-trick bag of stemmed unigrams and bigrams — genuinely
 * lexical, so "flooding on Aro Street" and "Aro Street flooding" really are
 * close and "traffic signals out in Karori" really is far. It is NOT semantic:
 * it cannot know that "inundation" means flooding. That is the entire
 * difference, and it is why the real path is preferred whenever a key exists.
 *
 * Pure function, no exports beyond the vector — everything fallible lives in
 * embed-signals-use-case.ts.
 */

/** One shared, fixed axis every vector leans on — see EMBED_ANISOTROPY. */
const BACKGROUND = buildBackground();

const HASHES_PER_FEATURE = 2;

/** Function words carry no location or hazard, and they inflate every pair's similarity. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "for", "from", "had", "has",
  "have", "he", "her", "his", "in", "into", "is", "it", "its", "of", "off", "on", "onto", "or",
  "our", "out", "over", "s", "she", "so", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "to", "up", "was", "we", "were", "with",
]);

export function stubEmbedding(text: string): number[] {
  const tokens = tokenise(text);
  const vector = new Array<number>(EMBED_DIMENSIONS).fill(0);

  // Unigrams place the vector; bigrams sharpen it, so two reports of the same
  // event separate cleanly from two reports that merely share vocabulary.
  for (const token of tokens) addFeature(vector, token);
  for (let i = 1; i < tokens.length; i += 1) addFeature(vector, `${tokens[i - 1]}_${tokens[i]}`);

  const lexical = normalise(vector);

  // Real embedding spaces are strongly anisotropic: every vector carries a large
  // shared component, which is why cosine similarities cluster high rather than
  // around zero. Mirroring that here means one threshold works for both paths.
  const blended = new Array<number>(EMBED_DIMENSIONS);
  for (let i = 0; i < EMBED_DIMENSIONS; i += 1) {
    blended[i] = EMBED_ANISOTROPY * BACKGROUND[i] + (1 - EMBED_ANISOTROPY) * lexical[i];
  }
  return normalise(blended);
}

// ─── features ─────────────────────────────────────────────────────────────────

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

/** Crude suffix stripping — enough that "flooding"/"flooded"/"floods" agree. */
function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** The hashing trick: signed, so unrelated features cancel instead of piling up. */
function addFeature(vector: number[], feature: string): void {
  for (let j = 0; j < HASHES_PER_FEATURE; j += 1) {
    const index = fnv1a(`${feature}#${j}`) % EMBED_DIMENSIONS;
    const sign = fnv1a(`${feature}$${j}`) % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
}

// ─── deterministic primitives ────────────────────────────────────────────────

/** FNV-1a, 32-bit. Stable across processes and machines — that is the whole point. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A fixed pseudo-random unit vector — the same one on every machine, forever. */
function buildBackground(): number[] {
  let state = 0x9e3779b9;
  const out = new Array<number>(EMBED_DIMENSIONS);
  for (let i = 0; i < EMBED_DIMENSIONS; i += 1) {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    out[i] = (state >>> 8) / 0x1000000 - 0.5;
  }
  return normalise(out);
}

function normalise(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm === 0) return vector;
  const scale = 1 / Math.sqrt(norm);
  return vector.map((value) => value * scale);
}
