import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useFollowList } from '@/data/hooks/useProfile';
import { useEntity } from '@/data/hooks/useEntity';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { useRouting } from '@/data/hooks/useRouting';
import { useProfiles } from '@/data/hooks/useProfile';
import { moveFollow, moveMute, parseFollows, parseMutes, parsePrivateFollows } from '@/lib/outbox';
import { npubOf } from '@/lib/format';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { PrivacyTag } from '@/components/PrivacyTag';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Page } from '@/components/Page';
import { Link } from 'react-router-dom';

type Visibility = 'public' | 'private';
type ListKind = 'follows' | 'mutes';

/** One person row: avatar, name, npub, and the move/remove actions. */
const PersonRow = ({
  pubkey,
  metadata,
  actions,
}: {
  pubkey: string;
  metadata?: { display_name?: string; name?: string; picture?: string };
  actions: React.ReactNode;
}) => {
  const name = metadata?.display_name || metadata?.name;
  return (
    <li className="flex items-center gap-3 py-2">
      <Link to={`/${npubOf(pubkey)}`} className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80">
        <ProfileAvatar pubkey={pubkey} metadata={metadata} className="size-9" />
        <span className="min-w-0">
          <span className="block truncate text-sm">{name ?? npubOf(pubkey).slice(0, 16) + '…'}</span>
          <span className="text-muted-foreground block truncate font-mono text-[10px]">{npubOf(pubkey)}</span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center gap-1">{actions}</span>
    </li>
  );
};

/** One section header: label, count, and the bulk move when it applies. */
const SectionHead = ({ label, count, onBulk, bulkLabel }: {
  label: string;
  count: number;
  onBulk?: () => void;
  bulkLabel?: string;
}) => (
  <div className="flex items-center justify-between pt-1">
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      {label}
      <span className="text-muted-foreground font-mono text-[10px]">{count}</span>
      {label === 'private' && <PrivacyTag grade="private">private</PrivacyTag>}
    </h3>
    {onBulk && count > 0 && bulkLabel && (
      <Button
        variant="privacy"
        size="sm"
        className={cn(PRIVACY_BUTTON, PRIVACY.medium.className, 'h-7 px-2 text-[10px]')}
        onClick={onBulk}
      >
        {bulkLabel}
      </Button>
    )}
  </div>
);

const EmptyRow = () => <li className="text-muted-foreground py-2 text-sm">(none)</li>;

/** One list page: public + private sections, per-person moves, bulk seal. */
export const ListPage = ({ kind, title }: { kind: ListKind; title: string }) => {
  useSeoMeta({ title: `${title} — nostr.black` });
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const { request, dialog } = useBroadcastFlow();
  const { relays } = useRouting();
  const follows = useFollowList(user?.pubkey);
  const muteList = useEntity(user?.pubkey ? { type: 'muteList', pubkey: user.pubkey } : undefined);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const event = kind === 'follows' ? follows.event : muteList.event;
  const mutes = sk ? parseMutes(sk, event) : { public: [], private: [] };
  const publicItems = kind === 'follows' ? parseFollows(event) : mutes.public;
  const privateItems = kind === 'follows'
    ? ((): string[] => {
        if (!sk || !event) return [];
        try { return parsePrivateFollows(sk, event); } catch { return []; }
      })()
    : mutes.private;
  const allProfiles = [...new Set([...publicItems, ...privateItems])];
  const profiles = useProfiles(allProfiles, 'interactive');

  const movePerson = (pubkey: string, from: Visibility, to: Visibility) => {
    const mover = kind === 'follows' ? moveFollow : moveMute;
    if (!user?.signer || !sk) return;
    void (async () => {
      const parts = mover(sk, event, pubkey, to);
      const signed = await user.signer.signEvent({
        kind: kind === 'follows' ? 3 : 10000,
        content: parts.content,
        tags: parts.tags,
        created_at: Math.floor(Date.now() / 1000),
      });
      const noun = kind === 'follows' ? 'follow' : 'mute';
      request({
        grade: 'public',
        label: `${noun} move`,
        content: `move ${npubOf(pubkey).slice(0, 16)}… ${from} → ${to}`,
        identityPubkey: user.pubkey,
        relays: relays({ kind: 'publish', eventKind: signed.kind }),
        events: [signed],
      });
    })();
  };

  const bulkToPrivate = () => {
    const mover = kind === 'follows' ? moveFollow : moveMute;
    if (!user?.signer || !sk) return;
    void (async () => {
      // moveFollow/moveMute move one person; bulk = fold over the list.
      let tags = event?.tags ?? [];
      let content = event?.content ?? '';
      for (const pubkey of publicItems) {
        const base: NostrEvent = { ...(event ?? { id: '', pubkey: user.pubkey, created_at: 0, kind: kind === 'follows' ? 3 : 10000, tags, content, sig: '' }), tags, content };
        const more = mover(sk, base, pubkey, 'private');
        tags = more.tags;
        content = more.content;
      }
      const signed = await user.signer.signEvent({
        kind: kind === 'follows' ? 3 : 10000,
        content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });
      request({
        grade: 'public',
        label: kind === 'follows' ? 'follows to private' : 'mutes to private',
        content: `seal ${publicItems.length} ${kind === 'follows' ? 'follows' : 'mutes'} — only you can read them`,
        identityPubkey: user.pubkey,
        relays: relays({ kind: 'publish', eventKind: signed.kind }),
        events: [signed],
      });
      setConfirmBulk(false);
    })();
  };

  const profileOf = (pubkey: string) => profiles.get(pubkey)?.metadata;

  const rowActions = (from: Visibility, pubkey: string) => (
    <>
      {from === 'public' && (
        <Button
          variant="privacy"
          size="xs"
          className={cn(PRIVACY_BUTTON, PRIVACY.medium.className, 'h-7 px-2 text-[10px]')}
          onClick={() => movePerson(pubkey, 'public', 'private')}
        >
          make semi-private
        </Button>
      )}
      {from === 'private' && (
        <Button
          variant="privacy"
          size="xs"
          className={cn(PRIVACY_BUTTON, PRIVACY.public.className, 'h-7 px-2 text-[10px]')}
          onClick={() => movePerson(pubkey, 'private', 'public')}
        >
          make public
        </Button>
      )}
    </>
  );


  return (
    <Page title={title}>
      <div className="space-y-6">
        <div className="bg-privacy-public text-privacy-public-fg space-y-2 rounded-sm border border-privacy-public/30 p-4">
          <SectionHead
            label="public"
            count={publicItems.length}
            onBulk={publicItems.length > 0 ? () => setConfirmBulk(true) : undefined}
            bulkLabel="make all semi-private"
          />
          <ul className="space-y-1">
            {publicItems.map((pubkey) => (
              <PersonRow key={pubkey} pubkey={pubkey} metadata={profileOf(pubkey)} actions={rowActions('public', pubkey)} />
            ))}
            {publicItems.length === 0 && <EmptyRow />}
          </ul>
        </div>

        <div className="bg-privacy-medium text-privacy-medium-fg space-y-2 rounded-sm border border-privacy-medium/30 p-4">
          <div className="flex items-center justify-between pt-1">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              private
              <span className="text-muted-foreground font-mono text-[10px]">{privateItems.length}</span>
            </h3>
          </div>
          <ul className="space-y-1">
            {privateItems.map((pubkey) => (
              <PersonRow key={pubkey} pubkey={pubkey} metadata={profileOf(pubkey)} actions={rowActions('private', pubkey)} />
            ))}
            {privateItems.length === 0 && <EmptyRow />}
          </ul>
        </div>
      </div>
      {dialog}
      {confirmBulk && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="bg-background border-border flex items-center gap-3 rounded-sm border px-4 py-3 shadow-lg">
            <p className="text-sm">
              make all {publicItems.length} {kind === 'follows' ? 'follows' : 'mutes'} private? they stay {kind === 'follows' ? 'in your feed' : 'hidden'} — only the visibility changes.
            </p>
            <Button size="sm" onClick={bulkToPrivate}>confirm</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmBulk(false)}>cancel</Button>
          </div>
        </div>
      )}
    </Page>
  );
};

export const FollowsPage = () => <ListPage kind="follows" title="follows" />;
export const MutesPage = () => <ListPage kind="mutes" title="mutes" />;
