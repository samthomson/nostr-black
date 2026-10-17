import { useRef } from 'react';
import type { MouseEvent } from 'react';

/**
 * The brand mark: "nostr black", redacted — classified-document style.
 * Hovering gives a spotlight that reveals the letters under it (per word),
 * so it stays blacked out until peeked. Selecting still reveals: the bar
 * inverts to white-on-black.
 */
export const BrandMark = ({ className = '' }: { className?: string }) => {
  const rootRef = useRef<HTMLSpanElement>(null);
  const wordsRef = useRef<HTMLElement[] | null>(null);

  /** The two redaction bars, queried once and cached — they never change. */
  const words = (): HTMLElement[] => {
    if (!wordsRef.current && rootRef.current) {
      wordsRef.current = Array.from(rootRef.current.querySelectorAll<HTMLElement>('.brand-mark'));
    }
    return wordsRef.current ?? [];
  };

  const reveal = (e: MouseEvent<HTMLSpanElement>) => {
    const { clientX, clientY } = e;
    // Read every rect first, then write every var — no interleaved reflow.
    const spots = words().map((word) => {
      const rect = word.getBoundingClientRect();
      return {
        word,
        x: ((clientX - rect.left) / rect.width) * 100,
        y: ((clientY - rect.top) / rect.height) * 100,
      };
    });
    for (const { word, x, y } of spots) {
      word.style.setProperty('--reveal-x', `${x}%`);
      word.style.setProperty('--reveal-y', `${y}%`);
    }
  };

  const hide = () => {
    for (const word of words()) {
      word.style.removeProperty('--reveal-x');
      word.style.removeProperty('--reveal-y');
    }
  };

  return (
    <span
      ref={rootRef}
      onMouseMove={reveal}
      onMouseLeave={hide}
      className={`inline-flex gap-1.5 font-mono lowercase tracking-tight ${className}`}
    >
      <span className="brand-mark"><span className="brand-mark-text">nostr</span></span>
      <span className="brand-mark"><span className="brand-mark-text">black</span></span>
    </span>
  );
};
