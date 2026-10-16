import { useRef } from 'react';
import type { MouseEvent } from 'react';

/**
 * The brand mark: "nostr black", redacted — classified-document style.
 * Hovering gives a magnifier cursor and a spotlight that reveals the
 * letters under it (per word), so it stays blacked out until peeked.
 * Selecting still reveals: the bar inverts to white-on-black.
 */
export const BrandMark = ({ className = '' }: { className?: string }) => {
  const ref = useRef<HTMLSpanElement>(null);

  const reveal = (e: MouseEvent<HTMLSpanElement>) => {
    const root = ref.current;
    if (!root) return;
    for (const word of root.querySelectorAll<HTMLElement>('.brand-mark')) {
      const rect = word.getBoundingClientRect();
      word.style.setProperty('--reveal-x', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      word.style.setProperty('--reveal-y', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    }
  };

  const hide = () => {
    const root = ref.current;
    if (!root) return;
    for (const word of root.querySelectorAll<HTMLElement>('.brand-mark')) {
      word.style.removeProperty('--reveal-x');
      word.style.removeProperty('--reveal-y');
    }
  };

  return (
    <span
      ref={ref}
      onMouseMove={reveal}
      onMouseLeave={hide}
      className={`inline-flex gap-1.5 font-mono lowercase tracking-tight ${className}`}
    >
      <span className="brand-mark"><span className="brand-mark-text">nostr</span></span>
      <span className="brand-mark"><span className="brand-mark-text">black</span></span>
    </span>
  );
};
