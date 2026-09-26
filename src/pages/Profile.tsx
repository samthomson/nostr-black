import { useQuery } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { Shell } from '@/components/Shell';
import { Note } from '@/components/Note';
import { queryRelay, queryRelays } from '@/net/relayClient';
import { parseRelayList, buildAuthorRelayMap } from '@/lib/outbox';
import { readRelays } from '@/lib/appRelays';
import { useAppContext } from '@/hooks/useAppContext';
import { npubOf } from '@/lib/format';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const PROFILE_NOTE_KINDS = [1, 6, 16, 20, 21, 1063, 30023];
const NOTES_LIMIT = 50;

/**
 * Profile page: the author's metadata and their latest notes, fetched from
 * their own declared relays (outbox model — we go where they publish).
 */
const ProfileBody = ({ pubkey }: { pubkey: string }) => {
  const { config } = useAppContext();
  const npub = npubOf(pubkey);

  // Where this author publishes: their kind 10002, asked on our read relays.
  const relayLists = useQuery({
    queryKey: ['profile', 'relays', pubkey],
    queryFn: async () => {
      const events = await queryRelays(
        readRelays(config),
        [{ kinds: [10002], authors: [pubkey], limit: 1 }],
      );
      return buildAuthorRelayMap(events).get(pubkey) ?? parseRelayList(undefined);
    },
  });

  const writeRelays = relayLists.data?.write ?? [];

  const metadata = useQuery({
    queryKey: ['profile', 'metadata', pubkey],
    queryFn: async () => {
      // kind 0 lives on the author's relays; fall back to ours.
      const own = writeRelays.length > 0
        ? await queryRelays(writeRelays, [{ kinds: [0], authors: [pubkey], limit: 1 }])
        : [];
      const events = own.length > 0
        ? own
        : await queryRelays(readRelays(config), [{ kinds: [0], authors: [pubkey], limit: 1 }]);
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return undefined;
      try {
        return JSON.parse(latest.content) as {
          name?: string;
          display_name?: string;
          about?: string;
          picture?: string;
          nip05?: string;
        };
      } catch {
        return undefined;
      }
    },
    enabled: relayLists.isSuccess,
  });

  const notes = useQuery({
    queryKey: ['profile', 'notes', pubkey, writeRelays.join(',')],
    enabled: relayLists.isSuccess && writeRelays.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        writeRelays.map((url) =>
          queryRelay(url, [{ kinds: PROFILE_NOTE_KINDS, authors: [pubkey], limit: NOTES_LIMIT }]),
        ),
      );
      return [...new Map(results.flat().map((e) => [e.id, e])).values()]
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, NOTES_LIMIT) as NostrEvent[];
    },
  });

  const about = metadata.data;
  const displayName = about?.display_name || about?.name || `${npub.slice(0, 10)}…`;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-14">
              {about?.picture && <AvatarImage src={about.picture} />}
              <AvatarFallback className="text-lg">{npub.slice(4, 6).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-semibold">{displayName}</p>
              {about?.nip05 && <p className="text-muted-foreground truncate text-sm">{about.nip05}</p>}
              <p className="text-muted-foreground truncate font-mono text-xs">{npub}</p>
            </div>
          </div>
          {about?.about && <p className="whitespace-pre-wrap break-words text-sm">{about.about}</p>}
        </CardContent>
      </Card>

      {notes.isLoading || relayLists.isLoading ? (
        Array.from({ length: 3 }, (_, i) => (
          <Card key={i}>
            <CardContent className="flex gap-3 p-4">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="w-full space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
              </div>
            </CardContent>
          </Card>
        ))
      ) : (notes.data ?? []).length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="px-8 py-12 text-center">
            <p className="text-muted-foreground mx-auto max-w-sm">
              {writeRelays.length === 0
                ? "couldn't find where this author publishes (no NIP-65 list)"
                : 'no notes found on their relays'}
            </p>
          </CardContent>
        </Card>
      ) : (
        (notes.data ?? []).map((event) => <Note key={event.id} event={event} />)
      )}
    </div>
  );
};

export const ProfilePage = ({ pubkey }: { pubkey: string }) => {
  const meta = useQuery({
    queryKey: ['profile', 'title', pubkey],
    queryFn: async () => {
      try {
        return `${npubOf(pubkey).slice(0, 16)}… — nostr.black`;
      } catch {
        return 'profile — nostr.black';
      }
    },
    initialData: `${npubOf(pubkey).slice(0, 16)}… — nostr.black`,
    staleTime: Infinity,
  });
  void nip19;
  useSeoMeta({ title: meta.data });

  return (
    <Shell>
      <ProfileBody pubkey={pubkey} />
    </Shell>
  );
};
