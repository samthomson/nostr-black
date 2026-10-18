import { useRef, useState } from 'react';
import { nowSec } from '@/lib/timestamp';
import { Link, useNavigate } from 'react-router-dom';
import { nip10, nip19 } from 'nostr-tools';
import { CornerDownRight, Heart, Info, Loader2, MessageCircle, Pencil, Repeat, Trash2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Rumor } from '@/lib/feedEncryption';
import { useProfile } from '@/data/hooks/useProfile';
import { useEvent } from '@/data/hooks/useEvent';
import { useAppContext } from '@/hooks/useAppContext';
import { Card, CardContent } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Button } from '@/components/ui/button';
import { EventInfoDialog } from '@/components/EventInfoDialog';
import { Chip, RelayPill, RoutePill } from '@/components/Pills';
import { EngagementCount } from '@/components/EngagementDialog';
import { useEngagementFeed } from '@/data/hooks/useEngagementFeed';
import { Composer } from '@/components/Composer';

import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Lightbox, LightboxTrigger } from '@/components/Lightbox';
import { ProfileHoverCard } from '@/components/ProfileHoverCard';
import { useColumns } from '@/components/columns/columnsState';
import { useAsset } from '@/hooks/useAsset';
import { profileHref, eventHref, npubOf, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PIN_OFFSET } from '@/lib/anchorSpacer';
import { clientTag as clientTagOf } from '@/lib/clientTag';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';

import { useRouting } from '@/data/hooks/useRouting';
import { PRIVACY, type PrivacyGrade } from '@/lib/privacy';
import { mediaUrls, MEDIA_URL, VIDEO_URL } from '@/lib/mediaUrls';
import { sanitizeUrl } from '@/lib/sanitizeUrl';


/** Content/image budget past which a note is collapsed with a fade. */
const CLAMP_THRESHOLD = 420;

const IMAGE_CLAMP_COUNT = 2;

/** Markdown reduced to plain prose for preview contexts. */
const stripMd = (md: string): string => md
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/[*_`>~]/g, '')
  .trim();
/** Link/accent colour for a privacy-graded surface: maroon pops on the
 * light public surface; on dark grades the grade's own fg keeps links
 * readable. */
const refClass = (grade: PrivacyGrade): string =>
  grade === 'public' ? 'text-maroon' : 'text-privacy-private-fg';


/** Renders a bech32 id (npub/note/nevent/naddr…) as a link to its route. */
const NostrRef = ({ bech32, grade }: { bech32: string; grade: PrivacyGrade }) => {
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

  // Mentions of a person get the hover card; note refs stay plain links.
  if (!pubkey) {
    return (
      <Link to={`/${bech32}`} className={cn(refClass(grade), 'underline underline-offset-2')}>
        @{label}
      </Link>
    );
  }
  return (
    <ProfileHoverCard pubkey={pubkey}>
      <Link to={`/${bech32}`} className={cn(refClass(grade), 'underline underline-offset-2')}>
        @{label}
      </Link>
    </ProfileHoverCard>
  );
};

/**
 * Renders note content as safe React nodes: nostr: entities (NIP-21),
 * non-image URLs and hashtags. Image URLs are hoisted out of the text into
 * the note's media grid — one way to render images, not two. Never uses
 * innerHTML — event content is untrusted (see AGENTS.md).
 */
const renderContent = (content: string, grade: PrivacyGrade) =>
  content
    .split(/(nostr:[a-z0-9]+|@(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+|https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/gu)
    .filter(Boolean)
    .filter((token) => !(token.startsWith('http') && MEDIA_URL.test(token)))
    .map((token, i) => {
      if (token.startsWith('nostr:')) {
        return <NostrRef key={i} bech32={token.slice(6)} grade={grade} />;
      }
      if (/^@(npub|nprofile|note|nevent|naddr)1/.test(token)) {
        return <NostrRef key={i} bech32={token.slice(1)} grade={grade} />;
      }
      if (/^https?:\/\//.test(token)) {
        const safe = sanitizeUrl(token);
        // http/non-https links still render as text — clicking out is
        // https-only in this app, but the words aren't lost.
        if (!safe) return token;
        return (
          <a
            key={i}
            href={safe}
            className={cn(refClass(grade), 'underline underline-offset-2 break-all')}
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            {token}
          </a>
        );
      }
      if (token.startsWith('#')) {
        return (
          <span key={i} className={refClass(grade)}>
            {token}
          </span>
        );
      }
      return token;
    });


/** Long urls in gated-media duds, kept to one line: truncated, and
 * wrapped anywhere (break-all) so no host runs the card wide. */
const truncatedUrl = (url: string): string => (url.length > 80 ? `${url.slice(0, 77)}…` : url);

/** One media item from an event: <img> or <video> (with controls), fetched
 * through the transport layer via useAsset. Failures are visible — a media
 * layer that fails silently is undebuggable. Images with `onOpen` zoom into
 * the note's lightbox.
 *
 * With media off in settings the item renders a dud card — the url and an
 * explicit load button — and fetches nothing until clicked: auto-fetching
 * gated media would beacon every server it names. */
const MediaItem = ({ url, alt, onOpen, tile = false }: { url: string; alt: string; onOpen?: () => void; tile?: boolean }) => {
  const { config } = useAppContext();
  const [loadRequested, setLoadRequested] = useState(false);
  const auto = config.mediaEnabled || loadRequested;
  const { url: src, error, ref } = useAsset(auto ? url : undefined);
  const frame = tile ? 'aspect-square w-full rounded-sm object-cover' : 'max-h-96 w-full rounded-sm object-cover';
  if (!auto) {
    return (
      <div className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-sm border bg-muted px-2 text-center">
        <span className="text-muted-foreground w-full break-all font-mono text-[10px]">
          {truncatedUrl(url)}
        </span>
        <Button variant="outline" size="sm" onClick={() => setLoadRequested(true)}>
          load
        </Button>
      </div>
    );
  }
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
        <video src={src} controls preload="metadata" className={frame} />
      </div>
    );
  }
  return (
    <div ref={ref}>
      {onOpen ? (
        <LightboxTrigger label="open image" onOpen={onOpen} className="w-full">
          <img src={src} alt={alt} className={frame} />
        </LightboxTrigger>
      ) : (
        <img src={src} alt={alt} className={frame} />
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

/** The media grid — the one layout for a note's images/videos, used by
 * the note body and embedded notes alike. */
const MediaGrid = ({ urls, alt, onOpen }: { urls: readonly string[]; alt: string; onOpen?: (index: number) => void }) => {
  if (urls.length === 0) return null;
  const tile = urls.length > 1;
  return (
    <div className={`mt-1 gap-1 ${tile ? 'grid grid-cols-2' : 'flex'}`}>
      {urls.map((url, i) => (
        <MediaItem key={url} url={url} alt={alt} tile={tile} onOpen={onOpen ? () => onOpen(i) : undefined} />
      ))}
    </div>
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
      {parentPubkey && href ? (
        <ProfileHoverCard pubkey={parentPubkey}>
          <Link to={href} className="underline underline-offset-2 hover:decoration-foreground">
            replying to {name ?? shortNpub}
          </Link>
        </ProfileHoverCard>
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
    {href ? (
      <Link
        to={href}
        className="text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground"
        aria-label="open replies"
      >
        <MessageCircle className="size-3.5" />
      </Link>
    ) : (
      <button
        type="button"
        className="text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground"
        onClick={onReplies}
        aria-label="reply"
      >
        <MessageCircle className="size-3.5" />
      </button>
    )}
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
/** Bring one card to the top of its scroll container. FLIP, not
 * scrollTop animation: the scroller freezes for the flight and the
 * content itself is translated (GPU transform — no layout reads, so a
 * feed that loads or prepends mid-flight cannot perturb it); the
 * handoff is one atomic scrollTop correction measured fresh. Animating
 * scrollTop directly fought live content and scroll anchoring — the
/** A flight in progress: a second scroll force-finishes it first —
 * overlapping transforms on the same content stack up and misland. */
let activeFlight: (() => void) | undefined;

const scrollCardToTop = (card: HTMLElement, durationMs = 550): void => {
  let scroller: HTMLElement | null = card.parentElement;
  // 'hidden' counts: while panes are open the feed column is frozen with
  // overflow-y-hidden, and hidden boxes are still programmatically
  // scrollable — exactly what the handoff needs.
  while (scroller && !['auto', 'scroll', 'hidden'].includes(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const content = scroller.firstElementChild as HTMLElement | null;
  if (!content) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  // How far the card sits below its destination (PIN_OFFSET in),
  // pre-freeze. Pin always targets the top — visible or not: the anchor
  // ring and dimming make the card the column's focus, and a "visible,
  // leave it" skip strands the last feed item mid-column.
  const delta = cardRect.top - scrollerRect.top - PIN_OFFSET;
  if (Math.abs(delta) < 2) return;
  // Finish any in-flight scroll before starting this one.
  activeFlight?.();
  const prevOverflow = scroller.style.overflow;
  scroller.style.overflow = 'hidden';
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    content.style.transform = '';
    scroller!.style.overflow = prevOverflow;
    activeFlight = undefined;
  };
  const easeInOut = (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const t0 = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / durationMs);
    content.style.transform = `translateY(${-delta * easeInOut(t)}px)`;
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    // Handoff, one frame: drop the transform, jump scrollTop to the
    // freshly measured position. Same paint — invisible.
    finish();
    const live = scroller!.scrollTop
      + card.getBoundingClientRect().top
      - scroller!.getBoundingClientRect().top
      - PIN_OFFSET;
    const max = scroller!.scrollHeight - scroller!.clientHeight;
    scroller!.scrollTop = Math.max(0, Math.min(live, max));
  };
  activeFlight = finish;
  requestAnimationFrame(step);
};

export const Note = ({ event, wrapper, foundOn, route, linkReplies = true, showContext = true, onReplies, onOpen, anchored, replyCek, onEdit, onDelete, edited = false, onEditHistory, children }: {
  event: NostrEvent | Rumor;
  /** Present when the item is private: the kind 1370/1470 wrapper. */
  wrapper?: NostrEvent;
  foundOn?: string[];
  route?: 'tor' | 'direct';
  linkReplies?: boolean;
  /** Feed-only: render the replied-to parent inline. Thread pages pass
   * false — the parent is already above, so replies read as replies. */
  showContext?: boolean;
  /** The conversation's reply CEK — lets the info dialog decode a 1470. */
  replyCek?: Uint8Array;
  onReplies?: () => void;
  /** Open this note elsewhere (a column) instead of navigating — body
   *  click and the reply count both route here. */
  onOpen?: () => void;
  /** True when the column to the right pertains to this note: it stays
   *  lit (and ringed) while its column dims everything else. Undefined
   *  lets the feed-level default apply (first open pane's note). */
  anchored?: boolean;
  /** Present when the item is editable (private notes): publish a
   *  revision with this content. */
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
  const { metadata, pending: authorPending } = useProfile(event.pubkey);
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [openMedia, setOpenMedia] = useState<number | null>(null);
  const isPrivate = wrapper !== undefined;
  const grade: PrivacyGrade = isPrivate ? 'private' : 'public';
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
  const navigate = useNavigate();
  const selfHref = eventHref(event.id, event.pubkey, foundOn ?? []);
  // Column opening: an explicit onOpen wins (a pane's replies name their
  // depth); otherwise a public note inside the column system opens one,
  // and only where panes fit — mobile keeps navigating as before. With
  // panes already open the feed is dimmed context: clicking it closes
  // them (back), it doesn't pivot to a new note.
  const stack = useColumns();
  // Any note inside the column system opens a pane — public and sealed
  // alike; the pane switches its data source on the flag.
  const openInColumn = stack?.enabled
    ? () => {
        if (stack.columns.length > 0) {
          stack.closeAll();
          return;
        }
        stack.open({
          id: event.id,
          author: event.pubkey,
          // Relay hints are for public fetches; a sealed pointer reads the
          // decrypted conversation instead, so it carries none.
          relays: wrapper === undefined ? foundOn : undefined,
          private: wrapper !== undefined,
        });
      }
    : undefined;
  const openNote = onOpen ?? openInColumn;
  const countsRef = useRef<HTMLDivElement>(null);
  /** Every open path — body click, reply count — opens the pane and then
   *  scrolls this card to the top of its column. Two frames after the
   *  commit: layout measured post-paint, nothing left to fight it. */
  const openAndScroll = (element: HTMLElement | null) => {
    if (!openNote) return;
    const card = element?.closest('[data-slot="card"]');
    openNote();
    if (!card) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollCardToTop(card as HTMLElement));
    });
  };
  const openSelf = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    if (openNote) {
      openAndScroll(e.currentTarget as HTMLElement);
      return;
    }
    if (selfHref) navigate(selfHref);
  };
  const isAnchored = anchored ?? (!onOpen && !!stack && stack.columns[0]?.id === event.id);
  const displayName = metadata?.display_name || metadata?.name;
  const npub = npubOf(event.pubkey);
  const href = profileHref(event.pubkey);
  const embedded = repostedEvent(event);
  const media = mediaUrls(event);
  const allMedia = [...media, ...(embedded ? mediaUrls(embedded) : [])];
  const isLongform = !embedded && event.kind === 30023;
  const longformTitle = isLongform
    ? event.tags.find(([n]) => n === 'title')?.[1]
    : undefined;
  // Longform preview: the markdown stripped to prose, clamped like any
  // other note (fade + read more). The title renders as a heading and
  // the cover lands in the media grid.
  const renderedText = embedded
    ? embedded.content
    : (event.kind === 30023 ? stripMd(event.content) : event.content);
  const clampable =
    !embedded && (renderedText.length > CLAMP_THRESHOLD || allMedia.length > IMAGE_CLAMP_COUNT);
  const kindLabel = KIND_LABELS[event.kind];
  // Reposts (6/16) point their e tag at the reposted note, not a reply
  // parent — they embed that note but never read as a reply.
  const isRepost = event.kind === 6 || event.kind === 16;
  const quoteTag = !embedded ? event.tags.find(([n]) => n === 'q') : undefined;
  const quotedId = quoteTag?.[1];
  const quotedAuthor = quoteTag?.[3];
  const quotedRelays = quoteTag?.[2] ? [quoteTag[2]] : [];
  const quotedViaTag = quoteTag !== undefined;
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
  const quoted = useEvent(quotedId, { author: quotedAuthor, hints: quotedRelays });
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
    <Card data-anchor={isAnchored || undefined} className={cn('py-0', PRIVACY[grade].surface)}>
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
              <ProfileHoverCard pubkey={event.pubkey}>
                <Link to={href} className="truncate text-sm font-bold hover:underline">
                  {displayName ?? `${npub.slice(0, 10)}…`}
                </Link>
              </ProfileHoverCard>
            ) : (
              <span className="truncate text-sm font-bold">
                {displayName ?? `${npub.slice(0, 10)}…`}
              </span>
            )}
            <span className="text-privacy-public-muted shrink-0 text-sm">
              {formatTimestamp(event.created_at)}
            </span>
            {edited && (
              <button
                type="button"
                onClick={onEditHistory}
                className="text-privacy-public-muted shrink-0 text-xs hover:underline"
                aria-label="edit history"
              >
                edited
              </button>
            )}
            {(kindLabel || quotedViaTag) && (
              <span className="flex shrink-0 items-center">
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
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={saveEdit}
              onCancel={() => setEditing(false)}
              variant="edit"
              grade={isPrivate ? 'private' : 'public'}
            />
          ) : (
          <>
          {showContext && parentId && !isRepost && (
            <ReplyContext
              parentPubkey={parentPubkey}
              settled={!parent.pending}
              loaded={!!parent.event}
            />
          )}
          {showContext && parentId && parent.event && (
            <div className="mb-3">
              <Note event={parent.event} showContext={false} />
            </div>
          )}

          {/* Body: hard max-height with a bottom fade when collapsed — no
              note may dominate the screen, whatever its text or images. */}
          <div className="relative cursor-pointer" onClick={openSelf}>
            <div className={clampable && !expanded ? 'max-h-80 overflow-hidden' : ''}>
              {isLongform && longformTitle && (
                <p className="text-base font-semibold leading-snug">{longformTitle}</p>
              )}
              {!embedded && (
                <div className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {renderContent(renderedText, grade)}
                </div>
              )}
              {!embedded && <MediaGrid urls={media} alt={altText} onOpen={setOpenMedia} />}
            </div>
            {clampable && !expanded && (
              <div className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-privacy-public to-transparent')} />
            )}
          </div>

          {embedded && (
            <div className="mt-3">
              <Note event={embedded} showContext={false} />
            </div>
          )}

          {quotedViaTag && (
            quoted.event ? (
              <div className="mt-3">
                <Note event={quoted.event} showContext={false} />
              </div>
            ) : (
              <Link
                to={quotedId ? (eventHref(quotedId, quotedAuthor ?? event.pubkey) ?? '/') : '/'}
                className="text-muted-foreground mt-1.5 block truncate rounded-sm border p-2.5 text-sm hover:underline"
              >
                quoting {quotedId?.slice(0, 16)}…
              </Link>
            )
          )}

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
            <div ref={countsRef} className="text-privacy-public-muted flex items-center gap-4 pt-1 text-sm" data-testid="note-counts">
              <ReplyCount
                replies={feed.replies}
                pending={feed.pending}
                capped={feed.capped}
                onReplies={openNote ? () => openAndScroll(countsRef.current) : onReplies}
                href={openNote || !linkReplies ? undefined : selfHref}
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
      <EventInfoDialog event={wrapper ?? (event as NostrEvent)} foundOn={foundOn} replyCek={replyCek} open={infoOpen} onOpenChange={setInfoOpen} />
    </Card>
  );
};
