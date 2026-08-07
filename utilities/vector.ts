/**
 * Vector maths for the grouping and galaxy layers. Pure functions — no IO, no
 * db, no logging, no zod. There is no pgvector here on purpose: embeddings are
 * plain `number[]` in jsonb and the similarity fold happens in this process,
 * which keeps the whole pipeline runnable against any stock Postgres.
 *
 * Everything below is total: mismatched or empty input returns a defined value
 * rather than throwing, because these run inside a per-signal loop that must
 * never take a batch down.
 */

/**
 * Cosine similarity in [-1, 1] (0 when either side is empty or degenerate).
 * The number that ends up as an edge's `weight`.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Element-wise mean. The fold-from-members form of a centroid — used for rebuilds. */
export function meanVector(vectors: readonly (readonly number[])[]): number[] {
  if (vectors.length === 0) return [];

  const dimensions = vectors[0].length;
  const out = new Array<number>(dimensions).fill(0);
  let counted = 0;

  for (const vector of vectors) {
    if (vector.length !== dimensions) continue; // defensive: ragged input is ignored, not fatal
    for (let i = 0; i < dimensions; i += 1) out[i] += vector[i];
    counted += 1;
  }

  if (counted === 0) return [];
  for (let i = 0; i < dimensions; i += 1) out[i] /= counted;
  return out;
}

/**
 * The O(1) centroid update for the hot path: fold one new member into a centroid
 * that already averages `count` members. Mathematically identical to
 * `meanVector` over all members, without re-reading 1536 floats per member.
 *
 * `count` is the member count BEFORE `next` joins; a fresh group (count 0)
 * simply becomes the new member's vector.
 */
export function runningCentroid(
  centroid: readonly number[] | null,
  count: number,
  next: readonly number[],
): number[] {
  if (centroid === null || count <= 0 || centroid.length !== next.length) return [...next];

  const out = new Array<number>(centroid.length);
  for (let i = 0; i < centroid.length; i += 1) {
    out[i] = (centroid[i] * count + next[i]) / (count + 1);
  }
  return out;
}

/** Project a vector onto a fitted basis row: `dot(v - mean, component)`. */
export function projectOnto(
  vector: readonly number[],
  mean: readonly number[],
  component: readonly number[],
): number {
  const length = Math.min(vector.length, mean.length, component.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += (vector[i] - mean[i]) * component[i];
  return sum;
}
