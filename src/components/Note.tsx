import { useState } from 'react';
import { nowSec } from '@/lib/timestamp';
import { Link } from 'react-router-dom';
import { nip10, nip19 } from 'nostr-tools';
import { CornerDownRight, Heart, Info, Loader2, MessageCircle, Pencil, Repeat, Trash2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Rumor } from '@/lib/feedEncryption';
import { useProfile } from '@/data/hooks/useProfile';
import { useEvent } from '@/data/hooks/useEvent';
import { useAppContext } from '@/hooks/useAppContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EventInfoDialog } from '@/components/EventInfoDialog';
import { Chip, RelayPill, RoutePill } from '@/components/Pills';
import { EngagementCount } from '@/components/EngagementDialog';
import { useEngagementFeed } from '@/data/hooks/useEngagementFeed';
import { NoteEditor } from '@/components/NoteEditor';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useAsset } from '@/hooks/useAsset';
import { profileHref, eventHref, npubOf, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { clientTag as clientTagOf } from '@/lib/clientTag';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { Lightbox, LightboxTrigger } from '@/components/Lightbox';
import { useRouting } from '@/data/hooks/useRouting';
import type { PrivacyGrade } from '@/lib/privacy';
import { mediaUrls, MEDIA_URL, VIDEO_URL } from '@/lib/mediaUrls';


/** Content/image budget past which a note is collapsed with a fade. */
const CLAMP_THRESHOLD = 420;
/** More images than this and the note is collapsed; stacks dominate screens. */
const IMAGE_CLAMP_COUNT = 2;

/** Renders a bech32 id (npub/note/nevent/naddr…) as a link to its route. */
const NostrRef = ({ bech32 }: { bech32: string }) => {
  const decoded = (() => {
    try {
      return nip19.decode(bech32);
    } catch {
      return null;
    }
  })();

  const pubkey = decoded
    ? decoded.type === 'npub' ? decoded.data
      : decoded.type === 'nprofile' ? decoded.data.pubkey
      : undefined
    : undefined;
  const { metadata } = useProfile(pubkey);

  // Untrusted event content: a malformed bech32 renders as plain text,
  // never crashes the whole feed.
  if (!decoded) return <span>{bech32}</span>;

  let label = `${bech32.slice(0, 10)}…`;
  if (decoded.type === 'npub' || decoded.type === 'nprofile') {
    label = metadata?.display_name || metadata?.name || label;
  } else if (decoded.type === 'note' || decoded.type === 'nevent' || decoded.type === 'naddr') {
    label = 'note';
  }

  return (
    <Link to={`/${bech32}`} className="text-primary underline underline-offset-2">
      @{label}
    </Link>
  );
};

/**
 * Renders note content as safe React nodes: nostr: entities (NIP-21),
 * non-image URLs and hashtags. Image URLs are hoisted out of the text into
 * the note's media grid — one way to render images, not two. Never uses
 * innerHTML — event content is untrusted (see AGENTS.md).
 */
const renderContent = (content: string) =>
  content
    .split(/(nostr:[a-z0-9]+|@(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+|https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/gu)
    .filter(Boolean)
    .filter((token) => !(token.startsWith('http') && MEDIA_URL.test(token)))
    .map((token, i) => {
      if (token.startsWith('nostr:')) {
        return <NostrRef key={i} bech32={token.slice(6)} />;
      }
      if (/^@(npub|nprofile|note|nevent|naddr)1/.test(token)) {
        return <NostrRef key={i} bech32={token.slice(1)} />;
      }
      if (/^https?:\/\//.test(token)) {
        return (
          <a
            key={i}
            href={token}
            className="text-primary underline underline-offset-2 break-all"
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            {token}
          </a>
        );
      }
      if (token.startsWith('#')) {
        return (
          <span key={i} className="text-primary">
            {token}
          </span>
        );
      }
      return token;
    });


/** One media item from an event: <img> or <video> (with controls), fetched
 * through the transport layer via useAsset. Failures are visible — a media
 * layer that fails silently is undebuggable. Images with `onOpen` zoom into
 * the note's lightbox. */
const MediaItem = ({ url, alt, onOpen }: { url: string; alt: string; onOpen?: () => void }) => {
  const { url: src, error, ref } = useAsset(url);
  if (!src) {
    if (error) {
      return (
        <div className="flex h-20 w-full items-center justify-center rounded-sm border border-dashed px-2 text-center font-mono text-[10px] text-red-500">
          media failed: {error}
        </div>
      );
    }
    return (
      <div ref={ref} className="flex h-32 w-full items-center justify-center gap-2 rounded-sm bg-muted text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        loading media…
      </div>
    );
  }
  if (VIDEO_URL.test(url)) {
    return (
      <div ref={ref}>
        <video src={src} controls preload="metadata" className="max-h-96 w-full rounded-sm object-cover" />
      </div>
    );
  }
  return (
    <div ref={ref}>
      {onOpen ? (
        <LightboxTrigger label="open image" onOpen={onOpen} className="w-full">
          <img src={src} alt={alt} className="max-h-96 w-full rounded-sm object-cover" />
        </LightboxTrigger>
      ) : (
        <img src={src} alt={alt} className="max-h-96 w-full rounded-sm object-cover" />
      )}
    </div>
  );
};

const KIND_LABELS: Record<number, string> = {
  6: 'repost',
  16: 'repost',
  20: 'picture',
  21: 'video',
  1063: 'file',
  30023: 'long-form',
};

/** Embedded event of a kind 6 repost, if parseable. */
const repostedEvent = (event: NostrEvent | Rumor): NostrEvent | null => {
  if (event.kind !== 6) return null;
  try {
    return JSON.parse(event.content) as NostrEvent;
  } catch {
    return null;
  }
};

/** Author block: name linking to the profile route. */
const AuthorLink = ({ pubkey }: { pubkey: string }) => {
  const { metadata } = useProfile(pubkey);
  const displayName = metadata?.display_name || metadata?.name;
  const npub = npubOf(pubkey);
  const href = profileHref(pubkey);

  return (
    <span className="truncate text-sm">
      {href ? (
        <Link to={href} className="font-medium hover:underline">
          {displayName ?? `${npub.slice(0, 10)}…`}
        </Link>
      ) : (
        displayName ?? `${npub.slice(0, 10)}…`
      )}
    </span>
  );
};

/** Compact rendering of a reposted/quoted event. */
/** The media grid — the one layout for a note's images/videos, used by
 * the note body and embedded notes alike. */
const MediaGrid = ({ urls, alt, onOpen }: { urls: readonly string[]; alt: string; onOpen?: (index: number) => void }) => {
  if (urls.length === 0) return null;
  return (
    <div className={`mt-1 gap-1 ${urls.length > 1 ? 'grid grid-cols-2' : 'flex'}`}>
      {urls.map((url, i) => (
        <MediaItem key={url} url={url} alt={alt} onOpen={onOpen ? () => onOpen(i) : undefined} />
      ))}
    </div>
  );
};

const EmbeddedNote = ({ event, grade }: { event: NostrEvent; grade: PrivacyGrade }) => {
  const [openMedia, setOpenMedia] = useState<number | null>(null);
  const urls = mediaUrls(event);
  const alt = event.tags.find(([n]) => n === 'alt')?.[1] ?? 'embedded media';
  return (
    <blockquote className="space-y-1 border-l-2 border-muted-foreground/30 pl-3">
      <AuthorLink pubkey={event.pubkey} />
      <div className="whitespace-pre-wrap break-words text-sm">
        {renderContent(event.content)}
      </div>
      <MediaGrid urls={urls} alt={alt} onOpen={setOpenMedia} />
      {openMedia !== null && urls[openMedia] && (
        <Lightbox
          urls={urls}
          index={openMedia}
          onIndex={setOpenMedia}
          onClose={() => setOpenMedia(null)}
          alt={alt}
          grade={grade}
        />
      )}
    </blockquote>
  );
};

/** Reply affordance: names the author of the parent event (the person
 * actually replied to). Prefers the loaded parent event's pubkey; until
 * then uses the NIP-10 e-tag author when present. */
const ReplyContext = ({
  parentPubkey,
  settled,
  loaded,
}: {
  parentPubkey: string | undefined;
  settled: boolean;
  loaded: boolean;
}) => {
  const { metadata } = useProfile(parentPubkey);
  const name = metadata?.display_name || metadata?.name;
  const href = parentPubkey ? profileHref(parentPubkey) : undefined;
  const shortNpub = parentPubkey ? `${npubOf(parentPubkey).slice(0, 10)}…` : '';
  return (
    <div className="text-muted-foreground flex items-center gap-1 text-xs">
      <CornerDownRight className="size-3" />
      {href ? (
        <Link to={href} className="underline underline-offset-2 hover:decoration-foreground">
          replying to {name ?? shortNpub}
        </Link>
      ) : (
        <span>replying to…</span>
      )}
      {!settled && <span className="text-muted-foreground/60">· fetching parent…</span>}
      {settled && !loaded && (
        <span className="text-muted-foreground/60">· parent not on your relays</span>
      )}
    </div>
  );
};

/**
 * Provenance footer: which relays served the event, and over which route.
 * Separate from content (below read-more) and visually distinct: muted relay
 * pills vs a colored route pill.
 */
const fmt = (n: number, capped: boolean): string => `${n}${capped ? '+' : ''}`;

/** Replies: same two-part shape, but both halves are the note route —
 * replies are notes, opened with the existing note-opening UI, never
 * listed as people. The count still reads as unknown-while-fetching. */
export const ReplyCount = ({
  replies,
  pending,
  capped,
  onReplies,
  href,
}: {
  replies: number;
  pending: boolean;
  capped: boolean;
  onReplies?: () => void;
  href?: string;
}) => (
  <span className="inline-flex items-center gap-1">
    <button
      type="button"
      className="text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground"
      onClick={onReplies}
      aria-label="reply"
    >
      <MessageCircle className="size-3.5" />
    </button>
    {replies === 0 && !pending ? (
      <span className="text-muted-foreground inline-flex items-center" aria-label="replies" data-testid="count-reply">
        <span className="text-sm">0</span>
      </span>
    ) : href ? (
      <Link
        to={href}
        className="text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground"
        aria-label="replies"
        data-testid="count-reply"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : (
          <span className="text-sm underline underline-offset-2">{fmt(replies, capped)}</span>
        )}
      </Link>
    ) : onReplies ? (
      <button
        type="button"
        onClick={onReplies}
        className="text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground"
        aria-label="replies"
        data-testid="count-reply"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : (
          <span className="text-sm underline underline-offset-2">{fmt(replies, capped)}</span>
        )}
      </button>
    ) : (
      <span className="text-muted-foreground inline-flex items-center" aria-label="replies" data-testid="count-reply">
        {pending ? <Loader2 className="size-3 animate-spin" /> : (
          <span className="text-sm underline underline-offset-2">{fmt(replies, capped)}</span>
        )}
      </span>
    )}
  </span>
);

const NoteMeta = ({
  foundOn,
  route,
  client,
}: {
  foundOn?: string[];
  route?: 'tor' | 'direct';
  client?: string;
}) => {
  if ((!foundOn || foundOn.length === 0) && !route && !client) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 border-t pt-1.5">
      {foundOn?.map((url) => (
        <RelayPill key={url} url={url} />
      ))}
      {client && (
        <span className="rounded-sm border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
          via {client}
        </span>
      )}
      {route && <RoutePill route={route} />}
    </div>
  );
};
/**
 * The one feed-item component. Public items take the signed event. Private
 * items take the decrypted rumor plus its wrapper — the relay-stored event,
 * which is what the info dialog shows; engagement counts and e-tag parent
 * resolution are public-only (a rumor id is unresolvable on relays, and
 * asking about one leaks the query).
 */
export const Note = ({ event, wrapper, foundOn, route, linkReplies = true, onReplies, onEdit, onDelete, edited = false, onEditHistory, children }: {
  event: NostrEvent | Rumor;
  /** Present when the item is private: the kind 1370/1470 wrapper. */
  wrapper?: NostrEvent;
  foundOn?: string[];
  route?: 'tor' | 'direct';
  linkReplies?: boolean;
  onReplies?: () => void;
  /** Present when the item is editable (private notes): publish a
   * revision with this content. */
  onEdit?: (content: string) => void;
  /** Present when the parent owns deletion (a private note deletes its
   * whole conversation). Falls back to a single-event NIP-09. */
  onDelete?: () => void;
  /** True when the item has superseded versions — renders an 'edited' mark. */
  edited?: boolean;
  /** Opens the item's edit history (the parent owns the dialog). */
  onEditHistory?: () => void;
  /** Extra rows in the action area — private items mount their own
   * reaction count here (conversation data, not relay data). */
  children?: React.ReactNode;
}) => {
  const { config } = useAppContext();
  const showMedia = config.mediaEnabled;
  const { metadata, pending: authorPending } = useProfile(event.pubkey);
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [openMedia, setOpenMedia] = useState<number | null>(null);
  const isPrivate = wrapper !== undefined;
  const { user } = useCurrentUser();
  const mine = !!user && event.pubkey === user.pubkey;
  const { request, dialog: broadcastDialog } = useBroadcastFlow();
  const { relays: planRelays } = useRouting();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => {
    setDraft(event.content);
    setEditing(true);
  };

  // A repost is a broadcast like everything else — same modal, same
  // queue, signed by the session signer. Clicking again takes it back.
  const confirmRepost = async () => {
    if (reposted) {
      const mine = feed.reposts.find((r) => r.pubkey === user!.pubkey)!;
      const deletion = await user!.signer.signEvent({
        kind: 5, content: '', tags: [['e', mine.id]], created_at: nowSec(),
      });
      request({
        grade: 'public',
        label: 'repost deletion',
        content: 'delete your repost',
        identityPubkey: user!.pubkey,
        relays: planRelays({ kind: 'publish', event: deletion }),
        events: [deletion],
      });
      return;
    }
    const target = event as NostrEvent;
    const engaged = await user!.signer.signEvent({
      kind: 6, content: '',
      tags: [['e', target.id], ['p', target.pubkey]],
      created_at: nowSec(),
    });
    request({
      grade: 'public',
      label: 'repost',
      content: `repost of ${target.id.slice(0, 16)}…`,
      identityPubkey: user!.pubkey,
      relays: planRelays({ kind: 'publish', event: engaged }),
      events: [engaged],
    });
  };

  // Public deletion previews in the broadcast modal like everything
  // else; private kinds flow up through onDelete instead.
  const confirmDelete = () => {
    if (onDelete) {
      onDelete();
      return;
    }
    void (async () => {
      const tags: string[][] = [['e', (event as NostrEvent).id]];
      const tag = clientTagOf();
      if (tag) tags.push(['client', tag]);
      const deletion = await user!.signer.signEvent({
        kind: 5, content: '', tags, created_at: nowSec(),
      });
      request({
        grade: 'public',
        label: 'deletion',
        content: 'delete this event from your relays',
        identityPubkey: (event as NostrEvent).pubkey,
        relays: planRelays({ kind: 'publish', event: deletion }),
        events: [deletion],
      });
    })();
  };

  const saveEdit = () => {
    const content = draft.trim();
    if (!content || !onEdit) return;
    onEdit(content);
    setEditing(false);
  };
  const displayName = metadata?.display_name || metadata?.name;
  const npub = npubOf(event.pubkey);
  const href = profileHref(event.pubkey);
  const embedded = repostedEvent(event);
  const media = showMedia ? mediaUrls(event) : [];
  const allMedia = showMedia ? [...media, ...(embedded ? mediaUrls(embedded) : [])] : [];
  const renderedText = embedded
    ? embedded.content
    : (event.kind === 30023
        ? (event.tags.find(([n]) => n === 'title')?.[1] ?? event.content)
        : event.content);
  const clampable =
    renderedText.length > CLAMP_THRESHOLD || allMedia.length > IMAGE_CLAMP_COUNT;
  const kindLabel = KIND_LABELS[event.kind];
  // Reposts (6/16) point their e tag at the reposted note, not a reply
  // parent — they embed that note but never read as a reply.
  const isRepost = event.kind === 6 || event.kind === 16;
  const referenceId = embedded?.id ?? event.tags.find(([n]) => n === 'q')?.[1];
  const quotedViaTag = !embedded && referenceId !== undefined;
  // A reply carries its parent in e tags — nip10.parse resolves root/reply
  // markers (and legacy positional tags). The replied-to *person* is the
  // author of the reply-target event — never "last p tag" (p tags are
  // unordered; reverse-iteration often puts the thread OP last).
  const nip10Ref = !embedded && !quotedViaTag && !isPrivate ? nip10.parse(event) : undefined;
  const parentId = nip10Ref?.reply?.id ?? nip10Ref?.root?.id;
  const taggedAuthor =
    nip10Ref?.reply?.author
    ?? (nip10Ref?.profiles?.length === 1 ? nip10Ref.profiles[0].pubkey : undefined);
  const parentHints = [
    ...(nip10Ref?.reply?.relays ?? nip10Ref?.root?.relays ?? []),
    ...(foundOn ?? []),
  ];
  const parent = useEvent(parentId, { author: taggedAuthor, hints: parentHints });
  const feed = useEngagementFeed(isPrivate ? undefined : event.id);
  const reposted = !!user && feed.reposts.some((r) => r.pubkey === user.pubkey);
  const reacted = !!user && feed.reactions.some((r) => r.pubkey === user.pubkey);

  // A reaction is a broadcast like everything else: the heart opens the
  // modal (pre-filled with the chosen emoji), confirmation enqueues. The
  // heart toggles — engaging again un-reacts via a kind 5 of your own.
  const react = async (emoji: string) => {
    if (!user) return;
    const target = event as NostrEvent;
    const mine = feed.reactions.find((r) => r.pubkey === user.pubkey);
    if (mine) {
      const deletion = await user.signer.signEvent({
        kind: 5, content: '', tags: [['e', mine.id]], created_at: nowSec(),
      });
      request({
        grade: 'public',
        label: 'reaction deletion',
        content: `delete your ${mine.content} reaction`,
        identityPubkey: user.pubkey,
        relays: planRelays({ kind: 'publish', event: deletion }),
        events: [deletion],
      });
      return;
    }
    const reaction = await user.signer.signEvent({
      kind: 7, content: emoji,
      tags: [['e', target.id], ['p', target.pubkey]],
      created_at: nowSec(),
    });
    request({
      grade: 'public',
      label: 'reaction',
      content: `${emoji} on ${target.id.slice(0, 16)}…`,
      identityPubkey: user.pubkey,
      relays: planRelays({ kind: 'publish', event: reaction }),
      events: [reaction],
    });
  };
  // Prefer the fetched parent's pubkey; fall back to NIP-10 e-tag author or
  // a lone p tag. Never profiles.at(-1).
  const parentPubkey = parent.event?.pubkey ?? taggedAuthor;
  const clientTag = event.tags.find(([n]) => n === 'client')?.[1];
  const altText = event.tags.find(([n]) => n === 'alt')?.[1] ?? 'image from a followed author';

  return (
    <Card className="py-0">
      <CardContent className="flex gap-3 px-4 py-3">
        <ProfileAvatar
          pubkey={event.pubkey}
          metadata={metadata}
          waitingMetadata={authorPending}
          className="size-10 shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            {href ? (
              <Link to={href} className="truncate text-sm font-bold hover:underline">
                {displayName ?? `${npub.slice(0, 10)}…`}
              </Link>
            ) : (
              <span className="truncate text-sm font-bold">
                {displayName ?? `${npub.slice(0, 10)}…`}
              </span>
            )}
            <span className="text-muted-foreground shrink-0 text-sm">
              {formatTimestamp(event.created_at)}
            </span>
            {edited && (
              <button
                type="button"
                onClick={onEditHistory}
                className="text-muted-foreground shrink-0 text-xs hover:underline"
                aria-label="edit history"
              >
                edited
              </button>
            )}
            {(kindLabel || quotedViaTag) && (
              <span className="text-muted-foreground flex shrink-0 items-center">
                <Chip>{kindLabel ?? 'quoted'}</Chip>
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-6 w-6 shrink-0 text-muted-foreground"
              onClick={() => setInfoOpen(true)}
              aria-label="event info"
            >
              <Info className="size-3.5" />
            </Button>
            {onEdit && mine && !editing && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground"
                onClick={startEdit}
                aria-label="edit note"
              >
                <Pencil className="size-3.5" />
              </Button>
            )}
            {mine && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground"
                onClick={confirmDelete}
                aria-label="delete note"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
          {editing ? (
            <NoteEditor
              draft={draft}
              onDraft={setDraft}
              onSave={saveEdit}
              onCancel={() => setEditing(false)}
            />
          ) : (
          <>
          {parentId && !isRepost && (
            <ReplyContext
              parentPubkey={parentPubkey}
              settled={!parent.pending}
              loaded={!!parent.event}
            />
          )}
          {parentId && parent.event && (
            <EmbeddedNote event={parent.event} grade={isPrivate ? 'private' : 'public'} />
          )}

          {/* Body: hard max-height with a bottom fade when collapsed — no
              note may dominate the screen, whatever its text or images. */}
          <div className="relative">
            <div className={clampable && !expanded ? 'max-h-80 overflow-hidden' : ''}>
              {embedded ? (
                <EmbeddedNote event={embedded} grade={isPrivate ? 'private' : 'public'} />
              ) : quotedViaTag ? (
                <Link
                  to={eventHref(referenceId, event.pubkey) ?? '/'}
                  className="text-muted-foreground block truncate border-l-2 border-muted-foreground/30 pl-3 text-sm hover:underline"
                >
                  {referenceId}
                </Link>
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm text-foreground/70">
                  {renderContent(renderedText)}
                </div>
              )}

              {!embedded && <MediaGrid urls={media} alt={altText} onOpen={setOpenMedia} />}
            </div>
            {clampable && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
            )}
          </div>

          {clampable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-0 text-muted-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'show less' : 'read more'}
            </Button>
          )}
          </>
          )}

          {!isPrivate && (
            <div className="text-muted-foreground flex items-center gap-4 pt-1 text-sm" data-testid="note-counts">
              <ReplyCount
                replies={feed.replies}
                pending={feed.pending}
                capped={feed.capped}
                onReplies={onReplies}
                href={linkReplies ? eventHref(event.id, event.pubkey) : undefined}
              />
              {/* zaps: no send/receive yet — the row ships without it
              <Count icon={<Zap className="size-4" />} count={...} label="zaps" /> */}
              <EngagementCount
                icon={<Repeat className="size-3.5" />}
                count={feed.reposts.length}
                capped={feed.repostsCapped}
                pending={feed.pending}
                mine={reposted}
                tab="reposts"
                reactions={feed.reactions}
                reposts={feed.reposts}
                onEngage={() => void confirmRepost()}
                ariaLabel="repost"
              />
              <EngagementCount
                icon={<Heart className={cn('size-4', reacted && 'fill-current')} />}
                count={feed.reactions.length}
                capped={feed.reactionsCapped}
                pending={feed.pending}
                mine={reacted}
                tab="reactions"
                reactions={feed.reactions}
                reposts={feed.reposts}
                onEngage={() => void react(config.defaultReaction)}
                onChoose={(emoji) => void react(emoji)}
                ariaLabel="react"
              />
            </div>
          )}
          {children}
          <NoteMeta foundOn={foundOn} route={route} client={clientTag} />
        </div>
      </CardContent>
      {broadcastDialog}

      {openMedia !== null && media[openMedia] && (
        <Lightbox
          urls={media}
          index={openMedia}
          onIndex={setOpenMedia}
          onClose={() => setOpenMedia(null)}
          alt={altText}
          grade={isPrivate ? 'private' : 'public'}
        />
      )}
      {/* No wrapper means the item is public, so event is signed. */}
      <EventInfoDialog event={wrapper ?? (event as NostrEvent)} foundOn={foundOn} open={infoOpen} onOpenChange={setInfoOpen} />
    </Card>
  );
};
