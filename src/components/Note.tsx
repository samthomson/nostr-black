import { useState } from 'react';
import { Link } from 'react-router-dom';
import { nip10, nip19 } from 'nostr-tools';
import { CornerDownRight, Info, Loader2, Repeat2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { useAuthor } from '@/hooks/useAuthor';
import { useEventById } from '@/hooks/useEventById';
import { useAppContext } from '@/hooks/useAppContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EventInfoDialog } from '@/components/EventInfoDialog';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useAsset } from '@/hooks/useAsset';
import { profileHref, eventHref, hostOf, npubOf, formatTimestamp } from '@/lib/format';

/** Content/image budget past which a note is collapsed with a fade. */
const CLAMP_THRESHOLD = 420;
/** More images than this and the note is collapsed; stacks dominate screens. */
const IMAGE_CLAMP_COUNT = 2;

/** Renders a bech32 id (npub/note/nevent/naddr…) as a link to its route. */
const NostrRef = ({ bech32 }: { bech32: string }) => {
  const decoded = nip19.decode(bech32);
  const pubkey =
    decoded.type === 'npub' ? decoded.data
    : decoded.type === 'nprofile' ? decoded.data.pubkey
    : undefined;
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;

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
 * Renders note content as safe React nodes: URLs, nostr: entities (NIP-21)
 * and hashtags become links/spans. Never uses innerHTML — event content is
 * untrusted (see AGENTS.md).
 */

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

const VIDEO_URL = /\.(mp4|webm|mov)(\?[^#\s]*)?$/i;
const MEDIA_URL = /\.(jpe?g|png|gif|webp|avif|mp4|webm|mov)(\?[^#\s]*)?$/i;

/** All media urls for an event: imeta/url tags plus media urls in content. */
const mediaUrls = (event: NostrEvent): string[] => {
  const urls: string[] = [];
  for (const [name, value, ...rest] of event.tags) {
    if (name === 'url' && value && MEDIA_URL.test(value)) urls.push(value);
    if (name === 'imeta') {
      const url = [value, ...rest].find((p) => p.startsWith('url '))?.slice(4);
      if (url) urls.push(url);
    }
  }
  for (const token of event.content.split(/\s+/)) {
    if (/^https?:\/\//.test(token) && MEDIA_URL.test(token)) urls.push(token);
  }
  return [...new Set(urls)];
};

/** One media item from an event: <img> or <video> (with controls), fetched
 * through the transport layer via useAsset. Failures are visible — a media
 * layer that fails silently is undebuggable. */
const MediaItem = ({ url, alt }: { url: string; alt: string }) => {
  const { url: src, error, ref } = useAsset(url);
  if (!src) {
    if (error) {
      return (
        <div className="flex h-20 w-full items-center justify-center rounded-md border border-dashed px-2 text-center font-mono text-[10px] text-red-500">
          media failed: {error}
        </div>
      );
    }
    return (
      <div ref={ref} className="flex h-32 w-full items-center justify-center gap-2 rounded-md bg-muted text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        loading media…
      </div>
    );
  }
  if (VIDEO_URL.test(url)) {
    return (
      <div ref={ref}>
        <video src={src} controls preload="metadata" className="max-h-96 w-full rounded-md object-cover" />
      </div>
    );
  }
  return (
    <div ref={ref}>
      <img src={src} alt={alt} className="max-h-96 w-full rounded-md object-cover" />
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
const repostedEvent = (event: NostrEvent): NostrEvent | null => {
  if (event.kind !== 6) return null;
  try {
    return JSON.parse(event.content) as NostrEvent;
  } catch {
    return null;
  }
};

/** Author block: name linking to the profile route. */
const AuthorLink = ({ pubkey }: { pubkey: string }) => {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
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
const EmbeddedNote = ({ event }: { event: NostrEvent }) => {
  const media = mediaUrls(event);

  return (
    <blockquote className="space-y-1 border-l-2 border-muted-foreground/30 pl-3">
      <AuthorLink pubkey={event.pubkey} />
      <div className="whitespace-pre-wrap break-words text-sm">
        {renderContent(event.content)}
      </div>
      {media.length > 0 && (
        <div className={`mt-1 gap-1 ${media.length > 1 ? 'grid grid-cols-2' : 'flex'}`}>
          {media.map((url) => (
            <MediaItem key={url} url={url} alt={event.tags.find(([n]) => n === 'alt')?.[1] ?? 'embedded media'} />
          ))}
        </div>
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
  const author = useAuthor(parentPubkey);
  const name = author.data?.metadata?.display_name || author.data?.metadata?.name;
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
        <span
          key={url}
          className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
        >
          {hostOf(url)}
        </span>
      ))}
      {client && (
        <span className="rounded-sm border px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
          via {client}
        </span>
      )}
      {route && (
        <span
          className={`rounded-sm px-1 py-0.5 font-mono text-[10px] leading-none ${
            route === 'tor'
              ? 'bg-emerald-600/15 text-emerald-500'
              : 'bg-amber-600/15 text-amber-500'
          }`}
        >
          {route === 'tor' ? '⏁ tor' : 'clearnet'}
        </span>
      )}
    </div>
  );
};
export const Note = ({ event, foundOn, route }: { event: NostrEvent; foundOn?: string[]; route?: 'tor' | 'direct' }) => {
  const { config } = useAppContext();
  const showMedia = config.mediaEnabled;
  const author = useAuthor(event.pubkey);
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name;
  const npub = npubOf(event.pubkey);
  const href = profileHref(event.pubkey);
  const embedded = repostedEvent(event);
  const media = showMedia ? mediaUrls(event) : [];
  const allMedia = showMedia
    ? [...mediaUrls(event), ...(embedded ? mediaUrls(embedded) : [])]
    : [];
  const renderedText = embedded
    ? embedded.content
    : (event.kind === 30023
        ? (event.tags.find(([n]) => n === 'title')?.[1] ?? event.content)
        : event.content);
  const clampable =
    renderedText.length > CLAMP_THRESHOLD || allMedia.length > IMAGE_CLAMP_COUNT;
  const kindLabel = KIND_LABELS[event.kind];
  const referenceId = embedded?.id ?? event.tags.find(([n]) => n === 'q')?.[1];
  const quotedViaTag = !embedded && referenceId !== undefined;
  // A reply carries its parent in e tags — nip10.parse resolves root/reply
  // markers (and legacy positional tags). The replied-to *person* is the
  // author of the reply-target event — never "last p tag" (p tags are
  // unordered; reverse-iteration often puts the thread OP last).
  const nip10Ref = !embedded && !quotedViaTag ? nip10.parse(event) : undefined;
  const parentId = nip10Ref?.reply?.id ?? nip10Ref?.root?.id;
  const taggedAuthor =
    nip10Ref?.reply?.author
    ?? (nip10Ref?.profiles?.length === 1 ? nip10Ref.profiles[0].pubkey : undefined);
  const parentHints = [
    ...(nip10Ref?.reply?.relays ?? nip10Ref?.root?.relays ?? []),
    ...(foundOn ?? []),
  ];
  const parent = useEventById(parentId, taggedAuthor, parentHints);
  // Prefer the fetched parent's pubkey; fall back to NIP-10 e-tag author or
  // a lone p tag. Never profiles.at(-1).
  const parentPubkey = parent.data?.pubkey ?? taggedAuthor;
  const clientTag = event.tags.find(([n]) => n === 'client')?.[1];
  const altText = event.tags.find(([n]) => n === 'alt')?.[1] ?? 'image from a followed author';

  return (
    <Card>
      <CardContent className="flex gap-3 p-4">
        <ProfileAvatar pubkey={event.pubkey} metadata={metadata} className="size-10 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2">
            {href ? (
              <Link to={href} className="truncate text-sm font-medium hover:underline">
                {displayName ?? `${npub.slice(0, 10)}…`}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium">
                {displayName ?? `${npub.slice(0, 10)}…`}
              </span>
            )}
            <span className="text-muted-foreground shrink-0 text-sm">
              {formatTimestamp(event.created_at)}
            </span>
            {(kindLabel || quotedViaTag) && (
              <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                <Repeat2 className="size-3" />
                {kindLabel ?? 'quoted'}
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
          </div>
          {parentId && (
            <ReplyContext
              parentPubkey={parentPubkey}
              settled={!parent.isPending}
              loaded={!!parent.data}
            />
          )}
          {parentId && parent.data && (
            <EmbeddedNote event={parent.data} />
          )}

          {/* Body: hard max-height with a bottom fade when collapsed — no
              note may dominate the screen, whatever its text or images. */}
          <div className="relative">
            <div className={clampable && !expanded ? 'max-h-80 overflow-hidden' : ''}>
              {embedded ? (
                <EmbeddedNote event={embedded} />
              ) : quotedViaTag ? (
                <Link
                  to={eventHref(referenceId, event.pubkey) ?? '/'}
                  className="text-muted-foreground block truncate border-l-2 border-muted-foreground/30 pl-3 text-sm hover:underline"
                >
                  {referenceId}
                </Link>
              ) : (
                <div className="whitespace-pre-wrap break-words text-sm">
                  {renderContent(renderedText)}
                </div>
              )}

              {!embedded && media.length > 0 && (
                <div className={`mt-1 gap-1 ${media.length > 1 ? 'grid grid-cols-2' : 'flex'}`}>
                  {media.map((url) => (
                    <MediaItem key={url} url={url} alt={altText} />
                  ))}
                </div>
              )}
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

          <NoteMeta foundOn={foundOn} route={route} client={clientTag} />
        </div>
      </CardContent>

      <EventInfoDialog event={event} foundOn={foundOn} open={infoOpen} onOpenChange={setInfoOpen} />
    </Card>
  );
};
