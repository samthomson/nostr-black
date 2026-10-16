import { X } from 'lucide-react';

import { useLocalStorage } from '@/hooks/useLocalStorage';

const STORAGE_KEY = 'nostr:beta-banner-dismissed';

/**
 * Site-wide announcement bar: thin full-width strip above the app.
 * Dismiss persists in localStorage so it stays gone across reloads.
 */
export const BetaBanner = () => {
  const [dismissed, setDismissed] = useLocalStorage(STORAGE_KEY, false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="bg-foreground text-background relative flex h-6 shrink-0 items-center justify-center gap-2 px-8 text-xs leading-none font-semibold tracking-wide"
    >
      <span>beta af — expect breakage</span>
      <button
        type="button"
        aria-label="dismiss"
        onClick={() => setDismissed(true)}
        className="absolute right-1 rounded-sm p-0.5 opacity-70 hover:opacity-100 sm:right-2"
      >
        <X className="size-3" strokeWidth={2.5} />
      </button>
    </div>
  );
};
