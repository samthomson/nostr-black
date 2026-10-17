/**
 * Where an opened note pins inside its column, from the scroller's top.
 * Single source of truth: the FLIP scroll, the spacer measurement and
 * the re-pin all target this offset.
 */
export const PIN_OFFSET = 56;

/**
 * Extra content height needed below the fold so the anchored card can pin
 * to the top of its scroller. Without it the browser clamps scrollTop at
 * (content height − viewport), and the last feed item — nothing below it —
 * can never reach the top.
 */
export const anchorSpacerHeight = (
  /** The card's offset from the scroller content's top, px. */
  cardTop: number,
  /** Scroller content height WITHOUT any spacer, px. */
  naturalHeight: number,
  /** The scroller's visible height (clientHeight), px. */
  viewport: number,
  /** Where the card should land from the scroller's top, px. */
  topOffset: number,
): number =>
  Math.max(0, Math.round(cardTop - topOffset + viewport - naturalHeight));
