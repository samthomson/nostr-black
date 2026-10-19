import { useContext, useMemo } from 'react';
import { UserStateContext } from '@/contexts/UserStateContext';
import { useProfiles } from '@/data/hooks/useProfile';
import { type MentionCandidate } from '@/lib/mentions';

/** A stable empty so a missing provider or an empty follow list never
 *  invalidates downstream memo deps. */
const EMPTY_PUBKEYS: readonly string[] = [];

/**
 * The mention candidates for the composer's `@` typeahead: the user's
 * synced follow list (public tags and sealed NIP-51 content alike —
 * the user state already merges them) with their kind 0 metadata
 * resolved in one batch at `interactive`. Ready the moment the follow
 * list has synced; no per-keystroke fetch. A Composer rendered without
 * a UserStateProvider (plain-input test harnesses) has no follows to
 * search — an empty candidate list, the typeahead never opens.
 *
 * `synced` distinguishes "follow list still coming from relays" from
 * "synced and genuinely empty/no match" — the typeahead opens either
 * way and says which, never a silent nothing.
 */
export interface MentionSource {
  candidates: readonly MentionCandidate[];
  synced: boolean;
}

export const useMentionCandidates = (): MentionSource => {
  const ctx = useContext(UserStateContext);
  const follows = ctx?.state.follows;
  const synced = (follows?.updatedAt ?? 0) > 0;
  const pubkeys = follows?.pubkeys ?? EMPTY_PUBKEYS;
  const key = pubkeys.join(',');
  const profiles = useProfiles(pubkeys, 'interactive');
  const candidates = useMemo(() => {
    if (key.length === 0) return [];
    return pubkeys
      .filter((pubkey) => profiles.has(pubkey))
      .map((pubkey) => ({ pubkey, metadata: profiles.get(pubkey)!.metadata }));
  }, [key, profiles, pubkeys]);
  return { candidates, synced };
};
