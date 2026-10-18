import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { npubOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Middle-clipped npub with a copy button — `aaaa…bbbb` text plus copy icon.
 * The text is plain; only the icon is the click target.
 */
export const NpubCopy = ({ pubkey, className = '' }: { pubkey: string; className?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(npubOf(pubkey));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pubkey]);
  return (
    <span className={cn('text-muted-foreground flex w-full max-w-full min-w-0 items-center gap-1 font-mono text-[11px]', className)}>
      <span className="truncate">{npubOf(pubkey)}</span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 cursor-pointer hover:text-foreground"
        aria-label="copy npub"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
};
