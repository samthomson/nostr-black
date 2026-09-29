/**
 * The brand mark: "nostr black", redacted — classified-document style.
 * Each word gets its own black strikeout bar; real text underneath, so
 * selecting reveals (the bar inverts to white-on-black) and copying yields
 * the words. Pure black on the off-black app background reads as
 * redaction, not a hole.
 */
export const BrandMark = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex gap-1.5 font-mono lowercase tracking-tight ${className}`}>
    <span className="brand-mark">nostr</span>
    <span className="brand-mark">black</span>
  </span>
);
