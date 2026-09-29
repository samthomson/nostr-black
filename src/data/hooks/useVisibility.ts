import { useEffect, useRef } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { extractWants } from '@/data/extract';
import { scheduler } from '@/data/scheduler';

/**
 * One observer at the note. On screen, its implied wants become
 * interactive; off screen they stay at whatever lane they were queued.
 * Promote-only: a scroll-off must not cancel an in-flight fetch.
 */
export const useVisibility = (event: NostrEvent) => {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(event);
  useEffect(() => {
    latest.current = event;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        const current = latest.current;
        for (const want of extractWants(current)) {
          scheduler.promote(want, 'interactive');
        }
        scheduler.promote({ type: 'engagement', target: current.id }, 'interactive');
      },
      { rootMargin: '80px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [event.id]);

  return ref;
};
