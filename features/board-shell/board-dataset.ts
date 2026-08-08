/**
 * The board reads ONE feed.
 *
 * There was a Live/Demo switch here. It was honest about the underlying model —
 * clustering never crosses datasets, so each namespace really is a separate
 * world — but it asked an operator to answer a question they should never have
 * to think about ("which reality am I looking at?") before they could look at
 * anything. One board, one feed.
 *
 * What it does NOT mean is that the honesty went away. Every item authored for
 * a demo or a drill still carries `synthetic` in the data and on every
 * provenance entry via the API. Per Jacob's call the INTERFACE no longer badges
 * it — the disclosure lives in the demo script's own words and the data itself,
 * not as chrome on the board.
 */
export const BOARD_DATASET = "live";
