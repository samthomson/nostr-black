import { useMemo } from 'react';
import type { NostrEvent, NostrMetadata } from '@nostrify/nostrify';
import { NSchema as n } from '@nostrify/nostrify';
import { parseRelayList, type RelayList } from '@/lib/outbox';
import { isPending, useEntities, useEntity } from './useEntity';
import type { Lane } from '@/data/scheduler';

/**
 * Identity lookups. These replace `useAuthor`, `useProfileMetadata` and
 * `useProfileRelays`, which each kept their own react-query entry and so
 * fetched the same kind 0 three times and disagreed about the answer.
 */

export interface Profile {
  metadata: NostrMetadata | undefined;
  event: NostrEvent | undefined;
  pending: boolean;
}

/**
 * Malformed metadata is the author's doing, not an app error: the event
 * still exists and everything else about it stays usable.
 */
const parseMetadata = (event: NostrEvent | undefined): NostrMetadata | undefined => {
  if (!event) return undefined;
  const parsed = n.json().pipe(n.metadata()).safeParse(event.content);
  return parsed.success ? parsed.data : undefined;
};

/** A pubkey's kind 0. Same entity for every caller, one fetch. */
export const useProfile = (
  pubkey: string | undefined,
  lane: Lane = 'interactive',
): Profile => {
  const state = useEntity(pubkey ? { type: 'profile', pubkey } : undefined, lane);
  const event = state.event;
  const metadata = useMemo(() => parseMetadata(event), [event]);

  return { metadata, event, pending: !!pubkey && isPending(state) };
};

/** Many profiles at once, for lists whose length changes between renders. */
export const useProfiles = (
  pubkeys: readonly string[],
  lane: Lane = 'interactive',
): ReadonlyMap<string, Profile> => {
  const states = useEntities('profile', pubkeys, lane);

  return useMemo(
    () =>
      new Map(
        [...states].map(([pubkey, state]) => [
          pubkey,
          { metadata: parseMetadata(state.event), event: state.event, pending: isPending(state) },
        ]),
      ),
    [states],
  );
};

export interface Relays {
  list: RelayList;
  event: NostrEvent | undefined;
  pending: boolean;
}

const NO_RELAYS: RelayList = Object.freeze({ read: [], write: [] }) as RelayList;

/** A pubkey's kind 10002 — where they read and where they publish. */
export const useRelayList = (
  pubkey: string | undefined,
  lane: Lane = 'interactive',
): Relays => {
  const state = useEntity(pubkey ? { type: 'relayList', pubkey } : undefined, lane);
  const event = state.event;

  const list = useMemo(() => (event ? parseRelayList(event) : NO_RELAYS), [event]);

  return { list, event, pending: !!pubkey && isPending(state) };
};

export interface FollowList {
  count: number;
  event: NostrEvent | undefined;
  pending: boolean;
}

/** A pubkey's kind 3 — used for the following count on a profile. */
export const useFollowList = (
  pubkey: string | undefined,
  lane: Lane = 'interactive',
): FollowList => {
  const state = useEntity(pubkey ? { type: 'followList', pubkey } : undefined, lane);
  const event = state.event;
  const count = event ? event.tags.filter((tag) => tag[0] === 'p' && tag[1]).length : 0;

  return { count, event, pending: !!pubkey && isPending(state) };
};
