import { useSeoMeta } from '@unhead/react';
import { Page } from '@/components/Page';
import { FollowsDialog } from '@/components/FollowsDialog';
import { Lightbox, LightboxTrigger } from '@/components/Lightbox';
import { Note } from '@/components/Note';
import { useAuthorNotes } from '@/data/hooks/useAuthorNotes';
import { useFollowers } from '@/data/hooks/useFollowers';
import { useFollowList, useProfile, useRelayList } from '@/data/hooks/useProfile';
import { npubOf } from '@/lib/format';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useAsset } from '@/hooks/useAsset';
import { Card, CardContent } from '@/components/ui/card';
import { NoteSkeleton } from '@/components/NoteSkeleton';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

/** Banner image through the same media path as avatars. */
const ProfileBanner = ({ url, onOpen }: { url: string | undefined; onOpen?: () => void }) => {
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
  const img = <img src={src} alt="" className="size-full object-cover" />;
  return (
    <div ref={ref} className="bg-muted h-32 w-full overflow-hidden sm:h-40">
      {onOpen ? (
        <LightboxTrigger label="open banner image" onOpen={onOpen} className="size-full">
          {img}
        </LightboxTrigger>
      ) : (
        img
      )}
    </div>
  );
};

const countLabel = (n: number, pending: boolean, capped = false): string => {
  if (pending) return '—';
  return `${n}${capped ? '+' : ''}`;
};

/**
 * Profile page: banner + avatar + identity + counts, then their notes from
 * their own declared relays (outbox model).
 */
const ProfileBody = ({ pubkey }: { pubkey: string }) => {
  const npub = npubOf(pubkey);

  // The same entities the feed and the account chip already resolved: one
  // kind 0 and one kind 10002 in the store, whoever asked for them first.
  const { metadata: about, pending: waitingMetadata } = useProfile(pubkey);
  const relayList = useRelayList(pubkey);
  const writeRelays = relayList.list.write;

  const notes = useAuthorNotes(pubkey);
  const follows = useFollowList(pubkey);
  const followers = useFollowers(pubkey);

  const [followsOpen, setFollowsOpen] = useState(false);
  const displayName = about?.display_name || about?.name || `${npub.slice(0, 10)}…`;
  const uniqueRelays = new Set([...relayList.list.write, ...relayList.list.read]).size;

  const [openMedia, setOpenMedia] = useState<number | null>(null);
  // One lightbox set for the profile: display picture first, cover second —
  // whichever exist. Clicking either opens it on that image.
  const gallery = [about?.picture, about?.banner].filter((u): u is string => !!u);
  const pictureIndex = about?.picture ? 0 : -1;
  const bannerIndex = about?.banner ? gallery.indexOf(about.banner) : -1;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-sm border bg-card">
        <ProfileBanner url={about?.banner} onOpen={bannerIndex >= 0 ? () => setOpenMedia(bannerIndex) : undefined} />
        <div className="relative px-4 pb-4">
          <div className="-mt-8 mb-3 sm:-mt-10">
            {pictureIndex >= 0 ? (
              <LightboxTrigger label="open profile picture" onOpen={() => setOpenMedia(pictureIndex)}>
                <ProfileAvatar
                  pubkey={pubkey}
                  metadata={about}
                  waitingMetadata={waitingMetadata}
                  className="border-background size-16 border-2 sm:size-20"
                />
              </LightboxTrigger>
            ) : (
              <ProfileAvatar
                pubkey={pubkey}
                metadata={about}
                waitingMetadata={waitingMetadata}
                className="border-background size-16 border-2 sm:size-20"
              />
            )}
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
            <button
              type="button"
              onClick={() => setFollowsOpen(true)}
              className="cursor-pointer hover:underline"
            >
              <span className="text-foreground font-medium">{countLabel(follows.count, follows.pending)}</span>
              {' '}following
            </button>
            <span>
              <span className="text-foreground font-medium">{countLabel(followers.count, followers.pending, followers.capped)}</span>
              {' '}followers
            </span>
            <span>
              <span className="text-foreground font-medium">{uniqueRelays || '—'}</span>
              {' '}relays
            </span>
          </div>
        </div>
      </div>

      {notes.pending && (
        <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-sm border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <Loader2 className="size-3.5 animate-spin" />
          fetching events{notes.notes.length > 0 ? ` — ${notes.notes.length} so far` : '…'}
        </div>
      )}
      {!notes.pending && notes.notes.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">{notes.notes.length} notes</p>
      )}

      {notes.notes.map((event) => <Note key={event.id} event={event} />)}

      {notes.pending &&
        Array.from({ length: notes.notes.length > 0 ? 2 : 3 }, (_, i) => (
          <NoteSkeleton key={`s${i}`} />
        ))}

      {!notes.pending && notes.notes.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="px-8 py-12 text-center">
            <p className="text-muted-foreground mx-auto max-w-sm">
              {writeRelays.length === 0
                ? "couldn't find where this author publishes (no NIP-65 list)"
                : 'no notes found on their relays'}
            </p>
          </CardContent>
        </Card>
      )}

      <FollowsDialog followList={follows.event} open={followsOpen} onOpenChange={setFollowsOpen} />
      {openMedia !== null && gallery[openMedia] && (
        <Lightbox
          urls={gallery}
          index={openMedia}
          onIndex={setOpenMedia}
          onClose={() => setOpenMedia(null)}
          alt={`${displayName} profile image`}
          grade="public"
        />
      )}
    </div>
  );
};

export const ProfilePage = ({ pubkey }: { pubkey: string }) => {
  useSeoMeta({ title: `${npubOf(pubkey).slice(0, 16)}… — nostr.black` });

  return (
    <Page>
      <ProfileBody pubkey={pubkey} />
    </Page>
  );
};
