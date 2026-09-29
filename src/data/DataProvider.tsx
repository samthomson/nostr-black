import { useEffect, useRef, type ReactNode } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { setSelf } from '@/data/context';
import { scheduler } from '@/data/scheduler';
import { persister } from '@/data/persist/persist';
import { startResolver } from '@/data/resolver';
import { useBootstrap } from '@/data/hooks/useBootstrap';

/**
 * Feeds React state into the data layer.
 *
 * The store and scheduler are module singletons — they outlive any tree and
 * have no context to read — so identity and relay config are pushed in from
 * here. Children declare their wants during their own effects, which run
 * first; the scheduler only reads this when a batch flushes, well after.
 *
 * Disk hydration runs in the same breath. Restore uses the replaceable
 * conflict rule, so a live fetch that won cannot be overwritten by an
 * older row from disk.
 */
export const DataProvider = ({ children }: { children: ReactNode }) => {
  const { config } = useAppContext();
  const { state } = useUserState();
  const { user } = useCurrentUser();

  const pubkey = user?.pubkey;
  const myRelays = state.relayMetadata.relays;
  const discovery = config.discoveryRelays;

  useBootstrap();

  useEffect(() => {
    void persister.start();
    const stopResolver = startResolver();
    return () => {
      stopResolver();
      void persister.stop();
    };
  }, []);

  useEffect(() => {
    setSelf({ pubkey, myRelays, discovery });
  }, [pubkey, myRelays, discovery]);

  // Switching accounts changes where everything is looked up, so nothing
  // learned under the old one may count as fresh. Only staleness is reset:
  // effects run child-first, so wiping declared wants here would strand
  // whatever mounted below on a spinner it can never clear.
  const known = useRef(false);
  useEffect(() => {
    if (!known.current) {
      known.current = true;
      return;
    }
    scheduler.invalidate();
  }, [pubkey]);

  return <>{children}</>;
};
