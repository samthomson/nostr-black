import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { Info, Repeat2 } from 'lucide-react';
import { useAuthor } from '@/hooks/useAuthor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EventInfoDialog } from '@/components/EventInfoDialog';
import { profileHref, eventHref, hostOf, npubOf, formatTimestamp } from '@/lib/format';

/** Content long enough to clamp by default. */
const CLAMP_THRESHOLD = 420;

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
    <a href={`/${bech32}`} className="text-primary underline underline-offset-2">
      @{label}
    </a>
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

/** Author block: avatar + name link to the profile route. */
const AuthorLink = ({ pubkey }: { pubkey: string }) => {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name;
  const npub = npubOf(pubkey);
  const href = profileHref(pubkey);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate text-sm">
        {href ? (
          <a href={href} className="font-medium hover:underline">
            {displayName ?? `${npub.slice(0, 10)}…`}
          </a>
        ) : (
          displayName ?? `${npub.slice(0, 10)}…`
        )}
      </span>
    </span>
  );
};

/** Compact rendering of a reposted/quoted event. */
const EmbeddedNote = ({ event, clamped }: { event: NostrEvent; clamped?: boolean }) => {
  const images = mediaUrls(event);

  return (
    <blockquote className="space-y-1 border-l-2 border-muted-foreground/30 pl-3">
      <AuthorLink pubkey={event.pubkey} />
      <div className={`whitespace-pre-wrap break-words text-sm ${clamped ? 'line-clamp-6' : ''}`}>
        {renderContent(event.content)}
      </div>
      {images.length > 0 && (
        <div className="space-y-1">
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
  // Clamp measures what's actually rendered: embedded note content (kind 6
  // content is a JSON blob, not display text) or the note's own text.
  const renderedText = embedded
    ? embedded.content
    : (event.kind === 30023
        ? (event.tags.find(([n]) => n === 'title')?.[1] ?? event.content)
        : event.content);
  const clampable = renderedText.length > CLAMP_THRESHOLD;
  const images = mediaUrls(event);
  const kindLabel = KIND_LABELS[event.kind];
  // kind 16 references the reposted event via e tag; kind 1 quotes via q tag.
  const referenceId =
    embedded?.id
    ?? event.tags.find(([n]) => n === 'e')?.[1]
    ?? event.tags.find(([n]) => n === 'q')?.[1];
  const quotedViaTag = !embedded && referenceId !== undefined;

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
              <a href={href} className="truncate text-sm font-medium hover:underline">
                {displayName ?? `${npub.slice(0, 10)}…`}
              </a>
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

          {embedded ? (
            <EmbeddedNote event={embedded} clamped={clampable && !expanded} />
          ) : quotedViaTag ? (
            <a
              href={eventHref(referenceId, event.pubkey) ?? '#'}
              className="text-muted-foreground block truncate border-l-2 border-muted-foreground/30 pl-3 text-sm hover:underline"
            >
              {referenceId}
            </a>
          ) : (
            <div
              className={`whitespace-pre-wrap break-words text-sm ${clampable && !expanded ? 'line-clamp-6' : ''}`}
            >
              {renderContent(
                event.kind === 30023
                  ? (event.tags.find(([n]) => n === 'title')?.[1] ?? event.content)
                  : event.content,
              )}
            </div>
          )}

          {!embedded && images.length > 0 && (
            <div className="space-y-1">
              {images.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt={event.tags.find(([n]) => n === 'alt')?.[1] ?? 'image from a followed author'}
                  className="max-h-96 w-full rounded-md object-cover"
                />
              ))}
            </div>
          )}

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
                {expanded ? 'show less' : 'show more'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      <EventInfoDialog event={event} open={infoOpen} onOpenChange={setInfoOpen} />
    </Card>
  );
};
