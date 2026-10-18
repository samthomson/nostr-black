import { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { npubOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Middle-clipped npub with a copy flash — `aaaa…bbbb` plus copy icon.
 * One line, used anywhere an npub is shown as copyable text.
 */
export const NpubCopy = ({ pubkey, className = '' }: { pubkey: string; className?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(npubOf(pubkey));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pubkey]);
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        'text-muted-foreground flex w-full max-w-full min-w-0 cursor-pointer items-center gap-1 font-mono text-[11px] hover:text-foreground',
        className,
      )}
      aria-label="copy npub"
    >
      <span className="truncate">{npubOf(pubkey)}</span>
      {copied ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
    </button>
  );
};
