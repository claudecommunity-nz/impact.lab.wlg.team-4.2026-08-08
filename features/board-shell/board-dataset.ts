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
 * a demo or a drill still carries `synthetic`, that flag still rides every
 * provenance entry, and the map still badges those clusters SYN. The warning
 * moved from a mode switch onto the individual pieces of evidence, which is
 * where it belongs: it is a fact about a report, not about a viewing mode.
 */
export const BOARD_DATASET = "live";
