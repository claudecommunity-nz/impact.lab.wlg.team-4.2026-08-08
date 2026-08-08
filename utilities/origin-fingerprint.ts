import { cosineSimilarity } from "@/utilities/vector";

/**
 * Which of these items are actually the SAME observation wearing different
 * hats. Pure — no db, no HTTP, no clock, no zod.
 *
 * This is the algorithmic centre of the whole module, and the reason is worth
 * stating plainly: the number a duty officer acts on is "how many independent
 * people saw this", and every mechanism the internet has — retweets,
 * screenshots, a news site quoting a post, one prolific account posting six
 * times — manufactures apparent corroboration out of a single observation.
 * Counting documents would make the system loudest exactly when it is being
 * echoed hardest, which is the opposite of what it is for.
 *
 * So: items in, an `originId` each, and `independentOrigins` = the count of
 * distinct ones. Three collapse rules, all of them conservative in the same
 * direction — when in doubt we count FEWER independent sources, never more,
 * because an over-count is the error that gets somebody sent to the wrong
 * street.
 *
 *   1. **near-duplicate text** — copy-paste amplification;
 *   2. **quoted URL** — an item linking another item's url is derivative of it;
 *   3. **same source + author** — one account is one witness, however often
 *      it posts.
 *
 * Union-find over items processed in a fixed order, so the same cluster always
 * fingerprints the same way regardless of the order rows came back from the
 * database. Determinism is not tidiness here: a replayed fixture must grade
 * identically every time it is run, and the origin count feeds the grade.
 */

export type FingerprintItem = {
  id: string;
  /** Where it came from — the registry key, and half of the author identity. */
  source: string;
  /** The account or byline, when the source distinguishes them. */
  author?: string | null;
  /** This item's own canonical link — what another item's quotedUrls points at. */
  url?: string | null;
  /** Links this item quotes or reposts. */
  quotedUrls?: readonly string[] | null;
  /** The honest sentence. Near-duplicate detection reads this, never `raw`. */
  text: string;
  /** Present once the item has been embedded; absent is normal, not an error. */
  embedding?: readonly number[] | null;
  /** Only used to pick which item in a collapsed set NAMES the origin. */
  occurredAt: Date;
};

export type OriginGroup = {
  /**
   * The id of the EARLIEST item in the set. Deliberately an existing item id
   * rather than a synthetic key: the origin of an observation is a thing
   * somebody actually published, and naming it after that item means a reader
   * can go and look at it.
   */
  originId: string;
  /** Every item that traces back to it, earliest first. Always includes originId. */
  itemIds: string[];
  /** Why these were collapsed, in words. Empty for an origin of one item. */
  reasons: string[];
};

export type OriginFingerprint = {
  /** itemId → originId, for every item passed in. */
  originById: Map<string, string>;
  /** The collapsed sets, ordered by their origin item's time then id. */
  originGroups: OriginGroup[];
  /** Distinct origins. THE number — never the item count. */
  independentOrigins: number;
};

/**
 * Cosine at or above this is "these two say the same thing". High on purpose:
 * 0.95 is not "related", it is "one of these is a copy of the other".
 */
export const NEAR_DUPLICATE_COSINE = 0.95;

/**
 * Token overlap at or above this is a near-duplicate on wording alone — the
 * fallback for items that have not been embedded yet, and the primary test
 * for a lexical embedder.
 */
export const NEAR_DUPLICATE_JACCARD = 0.85;

/**
 * The wording floor applied to the EMBEDDING path.
 *
 * A shared meaning is not a shared origin. Two people standing on opposite
 * corners of the same flooded intersection write two different sentences about
 * one event: an embedder scores them ~0.97, and collapsing them would erase
 * the corroboration this system exists to find — the most damaging thing this
 * module could do, because it turns real independent evidence into an echo.
 *
 * A copy-paste, by contrast, shares the actual words. So the embedding lets us
 * collapse at a LOWER lexical bar (a retweet with an added hashtag, a headline
 * with a publisher prefix), never at none.
 */
export const SHARED_WORDING_FLOOR = 0.5;

export function fingerprintOrigins(items: readonly FingerprintItem[]): OriginFingerprint {
  if (items.length === 0) {
    return { originById: new Map(), originGroups: [], independentOrigins: 0 };
  }

  // Fixed processing order: earliest first, id breaking ties. Everything below
  // depends on this — the representative of a collapsed set is its first item.
  const ordered = [...items].sort(compareItems);

  const parent = ordered.map((_, index) => index);
  const collapseReasons = new Map<number, string[]>();

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    // Path compression, so a long chain of reposts stays cheap.
    let walk = index;
    while (parent[walk] !== walk) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };

  const union = (a: number, b: number, reason: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      // Already one observation by another rule — still worth saying why twice.
      addReason(collapseReasons, rootA, reason);
      return;
    }
    // The EARLIER item always wins, because `ordered` is sorted and roots are
    // indexes into it: the origin is the first thing anybody published.
    const keep = Math.min(rootA, rootB);
    const merge = Math.max(rootA, rootB);
    parent[merge] = keep;
    for (const existing of collapseReasons.get(merge) ?? []) addReason(collapseReasons, keep, existing);
    collapseReasons.delete(merge);
    addReason(collapseReasons, keep, reason);
  };

  // ─── rule 2: quoted URL inheritance ─────────────────────────────────────────
  //
  // Done first, and it is the strongest signal here: an item that links another
  // item's url is not making an independent claim about the world, it is
  // pointing at somebody else's. A news article quoting a post is one witness
  // and one publisher, not two witnesses.
  const itemByUrl = new Map<string, number>();
  for (let i = 0; i < ordered.length; i += 1) {
    const url = normaliseUrl(ordered[i].url);
    // First writer wins: if two items claim the same canonical url, the earlier
    // one is the original and the later one will collapse into it below anyway.
    if (url !== null && !itemByUrl.has(url)) itemByUrl.set(url, i);
  }

  for (let i = 0; i < ordered.length; i += 1) {
    for (const quoted of ordered[i].quotedUrls ?? []) {
      const normalised = normaliseUrl(quoted);
      if (normalised === null) continue;
      const target = itemByUrl.get(normalised);
      if (target === undefined || target === i) continue;
      union(i, target, `quotes ${quoted} — a repost is not a second witness`);
    }
  }

  // ─── rule 3: same source + author ───────────────────────────────────────────
  //
  // One account is one observation however many times it posts. Requires an
  // author: a source that does not distinguish accounts (an official feed, a
  // sensor) must NOT have all its items collapsed into one, or MetService
  // publishing four separate warnings would read as a single observation.
  const byAuthor = new Map<string, number>();
  for (let i = 0; i < ordered.length; i += 1) {
    const key = authorKey(ordered[i]);
    if (key === null) continue;
    const first = byAuthor.get(key);
    if (first === undefined) byAuthor.set(key, i);
    else union(i, first, `same author on ${ordered[i].source} — one account is one observation`);
  }

  // ─── rule 1: near-duplicate text ────────────────────────────────────────────
  const tokens = ordered.map((item) => normaliseTokens(item.text));
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      if (find(i) === find(j)) continue; // already one observation
      const verdict = nearDuplicate(ordered[i], ordered[j], tokens[i], tokens[j]);
      if (verdict !== null) union(i, j, verdict);
    }
  }

  // ─── read the sets back out ─────────────────────────────────────────────────
  const membersByRoot = new Map<number, number[]>();
  for (let i = 0; i < ordered.length; i += 1) {
    const root = find(i);
    const existing = membersByRoot.get(root);
    if (existing) existing.push(i);
    else membersByRoot.set(root, [i]);
  }

  const originById = new Map<string, string>();
  const originGroups: OriginGroup[] = [];

  for (const root of [...membersByRoot.keys()].sort((a, b) => a - b)) {
    const members = membersByRoot.get(root) ?? [];
    const originId = ordered[root].id;
    const itemIds = members.map((index) => ordered[index].id);
    for (const itemId of itemIds) originById.set(itemId, originId);
    originGroups.push({
      originId,
      itemIds,
      reasons: members.length > 1 ? (collapseReasons.get(root) ?? []) : [],
    });
  }

  return { originById, originGroups, independentOrigins: originGroups.length };
}

/**
 * `originId` for a single item, when a caller has a fingerprint in hand — the
 * item's own id if it was never collapsed, which is also the honest answer for
 * an item nobody has compared it to yet.
 */
export function originIdFor(fingerprint: OriginFingerprint, itemId: string): string {
  return fingerprint.originById.get(itemId) ?? itemId;
}

// ─── internals ────────────────────────────────────────────────────────────────

/**
 * Are these two items the same observation, on their words alone? Returns the
 * sentence explaining why, or null.
 *
 * Two paths, ORed rather than one overriding the other: heavy wording overlap
 * is a duplicate whatever the vectors say, and near-identical meaning is a
 * duplicate provided the wording is substantially shared too (see
 * SHARED_WORDING_FLOOR — that gate is what stops two genuine witnesses of one
 * event being counted as one).
 */
function nearDuplicate(
  a: FingerprintItem,
  b: FingerprintItem,
  tokensA: Set<string>,
  tokensB: Set<string>,
): string | null {
  const overlap = jaccard(tokensA, tokensB);

  if (overlap >= NEAR_DUPLICATE_JACCARD) {
    return `near-identical wording (${overlap.toFixed(2)} token overlap) — copy-paste, not corroboration`;
  }

  const vectorA = a.embedding ?? null;
  const vectorB = b.embedding ?? null;
  if (vectorA !== null && vectorB !== null && vectorA.length > 0 && vectorA.length === vectorB.length) {
    const cosine = cosineSimilarity(vectorA, vectorB);
    if (cosine >= NEAR_DUPLICATE_COSINE && overlap >= SHARED_WORDING_FLOOR) {
      return `same text restated (cosine ${cosine.toFixed(3)}, ${overlap.toFixed(2)} token overlap)`;
    }
  }

  return null;
}

function compareItems(a: FingerprintItem, b: FingerprintItem): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function addReason(store: Map<number, string[]>, root: number, reason: string): void {
  const existing = store.get(root);
  if (!existing) {
    store.set(root, [reason]);
    return;
  }
  if (!existing.includes(reason)) existing.push(reason);
}

/** `source` + `author`, or null when the source does not distinguish accounts. */
function authorKey(item: FingerprintItem): string | null {
  const author = item.author?.trim().toLowerCase();
  if (author === undefined || author.length === 0) return null;
  return `${item.source.trim().toLowerCase()} ${author}`;
}

/**
 * Enough normalisation that two links to the same post match, and no more.
 * Query strings are KEPT: on plenty of sites they are the post id, and
 * stripping them would merge a whole feed into one observation.
 */
function normaliseUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * Words, lowercased, punctuation and links removed. A SET, not a list: repeated
 * words carry no extra evidence of copying, and a set keeps the comparison
 * symmetric and cheap.
 */
function normaliseTokens(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(cleaned.split(" ").filter((token) => token.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (large.has(token)) intersection += 1;

  return intersection / (a.size + b.size - intersection);
}
