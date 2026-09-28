import { useQuery } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { Shell } from '@/components/Shell';
import { Note } from '@/components/Note';
import { useProfileRelays, useProfileMetadata, useProfileNotes } from '@/hooks/useProfile';
import { npubOf } from '@/lib/format';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const PROFILE_NOTE_KINDS = [1, 6, 16, 20, 21, 1063, 30023];
const NOTES_LIMIT = 50;

/**
 * Profile page: the author's metadata and their latest notes, fetched from
 * their own declared relays (outbox model — we go where they publish).
 */
const ProfileBody = ({ pubkey }: { pubkey: string }) => {
  const npub = npubOf(pubkey);

  const relayLists = useProfileRelays(pubkey);

  const writeRelays = relayLists.data?.write ?? [];

  const metadata = useProfileMetadata(pubkey, writeRelays);

  const notes = useProfileNotes(pubkey, writeRelays, PROFILE_NOTE_KINDS, NOTES_LIMIT);

  const about = metadata.data;
  const displayName = about?.display_name || about?.name || `${npub.slice(0, 10)}…`;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <ProfileAvatar pubkey={pubkey} metadata={about} className="size-14" />
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
