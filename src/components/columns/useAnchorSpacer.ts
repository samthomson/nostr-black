import { useLayoutEffect, useRef, useState } from 'react';
import { PIN_OFFSET, anchorSpacerHeight } from '@/lib/anchorSpacer';

/**
 * Keeps the feed's anchored card pinned at PIN_OFFSET while panes are
 * open, two mechanisms in one:
 *
 * - A deficit spacer under the feed. The pin needs scroll room below the
 *   card; the last feed item has none, and the browser would clamp the
 *   scroll short. The spacer is exactly the missing height.
 * - A living measurement. The spacer is re-derived whenever the content
 *   box resizes (pages loading, churn): it reads the spacer's height
 *   from the DOM — never from state — so the loop converges instead of
 *   feeding back into itself. If churn re-clamps the scroll off the
 *   pin, it scrolls back; if the anchored note is evicted entirely, the
 *   spacer clears.
 *
 * The height is written to the DOM before React state: the re-pin in the
 * same pass must see the restored scroll room NOW, not a render later.
 * React later writes the same value from state; no conflict.
 */
export const useAnchorSpacer = (
  scrollerRef: React.RefObject<HTMLElement | null>,
  spacerRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  anchorId: string | undefined,
): number => {
  const [spacer, setSpacer] = useState(0);
  // Reset on close is render-phase (the exiting-panes pattern); the
  // browser then clamps scrollTop back to the natural position itself.
  if (!active && spacer !== 0) setSpacer(0);

  useLayoutEffect(() => {
    if (!active || !anchorId) return;
    const measure = (): void => {
      const scroller = scrollerRef.current;
      const spacerEl = spacerRef.current;
      const card = scroller?.querySelector('[data-anchor]') ?? null;
      if (!scroller || !spacerEl) return;
      if (!card) {
        spacerEl.style.height = '0px';
        setSpacer((cur) => (cur === 0 ? cur : 0));
        return;
      }
      const scrollerTop = scroller.getBoundingClientRect().top;
      const top = card.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
      const natural = scroller.scrollHeight - spacerEl.offsetHeight;
      const next = anchorSpacerHeight(top, natural, scroller.clientHeight, PIN_OFFSET);
      spacerEl.style.height = `${next}px`;
      setSpacer((cur) => (cur === next ? cur : next));
      // Never re-pin mid-FLIP — the scroller is frozen then and the
      // card rect is mid-transform.
      const offset = card.getBoundingClientRect().top - scrollerTop;
      // clientHeight 0 means no layout (jsdom): the offset is meaningless.
      if (
        scroller.style.overflow !== 'hidden'
        && scroller.clientHeight > 0
        && Math.abs(offset - PIN_OFFSET) > 2
      ) {
        scroller.scrollTop += offset - PIN_OFFSET;
      }
    };
    measure();
    const content = scrollerRef.current?.firstElementChild;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(content ?? document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, anchorId, scrollerRef, spacerRef]);

  return spacer;
};

/** Ref pair for the hook — a scroller and its trailing spacer div. */
export const useSpacerRefs = <T extends HTMLElement>():
  [React.RefObject<T | null>, React.RefObject<HTMLDivElement | null>] =>
  [useRef<T | null>(null), useRef<HTMLDivElement | null>(null)];
