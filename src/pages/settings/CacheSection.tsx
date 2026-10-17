import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Section } from './Section';
import { persister } from '@/data/persist/persist';
import { store } from '@/data/store';
import { scheduler } from '@/data/scheduler';
import { Button } from '@/components/ui/button';

/** Cache settings: what's on disk and in memory, and the one button that
 * drops all of it. Data is refetched on demand afterwards. */
export const CacheSection = () => {
  const [state, setState] = useState<'idle' | 'clearing' | 'cleared'>('idle');
  const counts = store.summary();

  const clear = async () => {
    setState('clearing');
    await persister.wipe();
    store.clear();
    scheduler.invalidate();
    setState('cleared');
  };

  return (
    <Section title="cache" hint="stored events on this device">
      <p className="text-muted-foreground text-sm">
        {counts.events} events · {counts.replaceable} replaceable · {counts.addressable} addressable.
        clearing drops the on-disk cache and everything in memory; it all refetches as needed.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={state !== 'idle'}
        onClick={() => void clear()}
        className="rounded-sm"
      >
        {state === 'idle' ? (
          <>
            <Trash2 className="size-3.5" />
            clear cache
          </>
        ) : state === 'clearing' ? (
          'clearing…'
        ) : (
          'cache cleared'
        )}
      </Button>
    </Section>
  );
};
