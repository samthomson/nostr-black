import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Copy button: icon that flips to a check for a beat after copying.
 * Always in the normal flow — callers place it in flex rows, so it can
 * never push content into a horizontal scroll.
 */
export const CopyButton = ({
  value,
  className,
  style,
}: {
  value: string;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      aria-label="copy value"
      onClick={() => void copy()}
      style={style}
      className={cn(
        'text-muted-foreground hover:text-foreground cursor-pointer rounded-sm p-0.5 transition-opacity',
        copied && 'text-copper',
        className,
      )}
    >
      {copied ? <Check aria-hidden="true" className="size-3" /> : <Copy aria-hidden="true" className="size-3" />}
    </button>
  );
};

/**
 * Hover-to-copy value: renders the payload; a copy button fades in
 * beside it on hover (in-flow, so layout never shifts and the button
 * wraps instead of overflowing).
 */
export const CopyValue = ({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <span className={cn('group/copy inline-flex max-w-full min-w-0 items-center gap-1', className)}>
    {children}
    <CopyButton
      value={value}
      className="shrink-0 opacity-0 group-hover/copy:opacity-100 focus-visible:opacity-100"
    />
  </span>
);
