import { useQuery } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { Shell } from '@/components/Shell';
import { Note } from '@/components/Note';
import {
  useProfileRelays,
  useProfileMetadata,
  useProfileNotes,
  useProfileFollows,
  useProfileFollowerSample,
} from '@/hooks/useProfile';
import { npubOf } from '@/lib/format';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useAsset } from '@/hooks/useAsset';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

const PROFILE_NOTE_KINDS = [1, 6, 16, 20, 21, 1063, 30023];
const NOTES_LIMIT = 50;

/** Banner image through the same media path as avatars. */
const ProfileBanner = ({ url }: { url: string | undefined }) => {
  const { url: src, error, ref } = useAsset(url, 'media');
  if (!url) {
    return <div className="bg-muted h-32 w-full sm:h-40" />;
  }
  if (error) {
    return (
      <div className="bg-muted text-muted-foreground flex h-32 w-full items-center justify-center text-xs sm:h-40">
        banner failed
      </div>
    );
  }
  if (!src) {
    return (
      <div className="bg-muted flex h-32 w-full items-center justify-center sm:h-40">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }
  return (
    <div ref={ref} className="bg-muted h-32 w-full overflow-hidden sm:h-40">
      <img src={src} alt="" className="size-full object-cover" />
    </div>
  );
};

/**
 * Profile page: banner + avatar + identity + counts, then their notes from
 * their own declared relays (outbox model).
 */
const ProfileBody = ({ pubkey }: { pubkey: string }) => {
  const npub = npubOf(pubkey);

  const relayLists = useProfileRelays(pubkey);
  const writeRelays = relayLists.data?.write ?? [];
  const metadata = useProfileMetadata(pubkey, writeRelays);
  const notes = useProfileNotes(pubkey, writeRelays, PROFILE_NOTE_KINDS, NOTES_LIMIT);
  const follows = useProfileFollows(pubkey, writeRelays);
  const followers = useProfileFollowerSample(pubkey, writeRelays);

  const about = metadata.data;
  const displayName = about?.display_name || about?.name || `${npub.slice(0, 10)}…`;
  const relayCount = (relayLists.data?.write.length ?? 0) + (relayLists.data?.read.length ?? 0);
  // write∪read may double-count; prefer unique from the map if available
  const uniqueRelays = relayLists.data
    ? new Set([...relayLists.data.write, ...relayLists.data.read]).size
    : 0;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-sm border bg-card">
        <ProfileBanner url={about?.banner} />
        <div className="relative px-4 pb-4">
          <div className="-mt-8 mb-3 sm:-mt-10">
            <ProfileAvatar
              pubkey={pubkey}
              metadata={about}
              className="border-background size-16 border-2 sm:size-20"
            />
          </div>

          <div className="space-y-1">
            <p className="truncate text-xl font-semibold">{displayName}</p>
            {about?.nip05 && (
              <p className="text-muted-foreground truncate text-sm">{about.nip05}</p>
            )}
            <p className="text-muted-foreground truncate font-mono text-xs">{npub}</p>
          </div>

          {about?.about && (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">{about.about}</p>
          )}
          {about?.website && (
            <a
              href={about.website.startsWith('http') ? about.website : `https://${about.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground mt-1 block truncate text-sm underline underline-offset-2"
            >
              {about.website}
            </a>
          )}

          <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>
              <span className="text-foreground font-medium">{follows.data ?? '—'}</span>
              {' '}following
            </span>
            <span>
              <span className="text-foreground font-medium">{followers.data ?? '—'}</span>
              {' '}followers
            </span>
            <span>
              <span className="text-foreground font-medium">{uniqueRelays || relayCount || '—'}</span>
              {' '}relays
            </span>
          </div>
        </div>
      </div>

      {notes.isLoading || relayLists.isLoading ? (
        Array.from({ length: 3 }, (_, i) => (
          <Card key={i}>
            <CardContent className="flex gap-3 p-4">
              <Skeleton className="size-8 shrink-0 rounded-sm" />
              <div className="w-full space-y-1.5">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-2.5 w-full" />
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
