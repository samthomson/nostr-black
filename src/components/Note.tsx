import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { Info, Repeat2 } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EventInfoDialog } from '@/components/EventInfoDialog';
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
  if (decoded.type === 'npub') {
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
const renderContent = (content: string) =>
  content
    .split(/(nostr:[a-z0-9]+|https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/gu)
    .filter(Boolean)
    .map((token, i) => {
      if (token.startsWith('nostr:')) {
        return <NostrRef key={i} bech32={token.slice(6)} />;
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

const KIND_LABELS: Record<number, string> = {
  6: 'repost',
  16: 'repost',
  20: 'picture',
  21: 'video',
  1063: 'file',
  30023: 'long-form',
};

/** Image/media urls from url, imeta and media tags. */
const mediaUrls = (event: NostrEvent): string[] => {
  const urls: string[] = [];
  for (const [name, value, ...rest] of event.tags) {
    if (name === 'url' && value) urls.push(value);
    if (name === 'imeta') {
      const url = [value, ...rest].find((p) => p.startsWith('url '))?.slice(4);
      if (url) urls.push(url);
    }
  }
  return urls;
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
  const images = mediaUrls(event);

  return (
    <blockquote className="space-y-1 border-l-2 border-muted-foreground/30 pl-3">
      <AuthorLink pubkey={event.pubkey} />
      <div className="whitespace-pre-wrap break-words text-sm">
        {renderContent(event.content)}
      </div>
      {images.length > 0 && (
        <div className={`mt-1 gap-1 ${images.length > 1 ? 'grid grid-cols-2' : 'flex'}`}>
          {images.map((url) => (
            <img
              key={url}
              src={url}
              alt={event.tags.find(([n]) => n === 'alt')?.[1] ?? 'embedded image'}
              className="max-h-96 w-full rounded-md object-cover"
            />
          ))}
        </div>
      )}
    </blockquote>
  );
};

export const Note = ({ event, foundOn }: { event: NostrEvent; foundOn?: string[] }) => {
  const author = useAuthor(event.pubkey);
  const [expanded, setExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name;
  const npub = npubOf(event.pubkey);
  const href = profileHref(event.pubkey);
  const embedded = repostedEvent(event);
  const images = mediaUrls(event);
  const allImages = [...images, ...(embedded ? mediaUrls(embedded) : [])];
  // Clamp measures what's actually rendered: embedded note content (kind 6
  // content is a JSON blob, not display text) or the note's own text, plus
  // image count — long image stacks dominate the screen just as much.
  const renderedText = embedded
    ? embedded.content
    : (event.kind === 30023
        ? (event.tags.find(([n]) => n === 'title')?.[1] ?? event.content)
        : event.content);
  const clampable =
    renderedText.length > CLAMP_THRESHOLD || allImages.length > IMAGE_CLAMP_COUNT;
  const kindLabel = KIND_LABELS[event.kind];
  // kind 16 references the reposted event via e tag; kind 1 quotes via q tag.
  const referenceId =
    embedded?.id
    ?? event.tags.find(([n]) => n === 'e')?.[1]
    ?? event.tags.find(([n]) => n === 'q')?.[1];
  const quotedViaTag = !embedded && referenceId !== undefined;
  const altText = event.tags.find(([n]) => n === 'alt')?.[1] ?? 'image from a followed author';

  return (
    <Card>
      <CardContent className="flex gap-3 p-4">
        <Avatar className="size-10 shrink-0">
          {metadata?.picture && <AvatarImage src={metadata.picture} />}
          <AvatarFallback>{npub.slice(4, 6).toUpperCase()}</AvatarFallback>
        </Avatar>
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

              {!embedded && images.length > 0 && (
                <div className={`mt-1 gap-1 ${images.length > 1 ? 'grid grid-cols-2' : 'flex'}`}>
                  {images.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt={altText}
                      className="max-h-96 w-full rounded-md object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
            {clampable && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
            )}
          </div>

          <div className="flex items-center gap-2">
            {foundOn && foundOn.length > 0 && (
              <span className="text-muted-foreground truncate text-xs">
                via {foundOn.map(hostOf).join(', ')}
              </span>
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
          </div>
        </div>
      </CardContent>

      <EventInfoDialog event={event} open={infoOpen} onOpenChange={setInfoOpen} />
    </Card>
  );
};
