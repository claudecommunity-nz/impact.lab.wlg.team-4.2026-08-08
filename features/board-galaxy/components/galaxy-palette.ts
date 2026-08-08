/**
 * A stable colour per cluster, derived from its id.
 *
 * Hashed rather than assigned from a list so a bubble keeps its colour across
 * polls, across reloads and across the map⇄galaxy toggle — an operator learns
 * "the violet cluster" within about ten seconds of watching, and a palette that
 * reshuffles on every refetch destroys that for nothing.
 *
 * Hues are pushed out of the teal band: teal is the interaction accent on this
 * board, and a cluster that happens to hash to teal would read as selected.
 */
export function groupColour(groupId: string | null): string {
  if (!groupId) return "#5c6d82";

  let hash = 0;
  for (let index = 0; index < groupId.length; index += 1) {
    hash = (hash * 31 + groupId.charCodeAt(index)) >>> 0;
  }

  let hue = hash % 360;
  if (hue > 158 && hue < 192) hue = (hue + 46) % 360;

  return `hsl(${hue}, 62%, 63%)`;
}

/** Ungrouped points are grey and small — "not yet clustered" is a real state. */
export const UNGROUPED_COLOUR = "#5c6d82";
