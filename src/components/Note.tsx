import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { useAuthor } from '@/hooks/useAuthor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const relativeTime = (createdAt: number): string => {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - createdAt));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

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

export const Note = ({ event }: { event: NostrEvent }) => {
  const author = useAuthor(event.pubkey);
  const [expanded, setExpanded] = useState(false);
  const metadata = author.data?.metadata;
  const displayName = metadata?.display_name || metadata?.name;
  const npub = nip19.npubEncode(event.pubkey);
  const clampable = event.content.length > CLAMP_THRESHOLD;

  return (
    <Card>
      <CardContent className="flex gap-3 p-4">
        <Avatar className="size-10 shrink-0">
          {metadata?.picture && <AvatarImage src={metadata.picture} />}
          <AvatarFallback>{npub.slice(4, 6).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="font-medium truncate">
              {displayName ?? `${npub.slice(0, 10)}…`}
            </span>
            <span className="text-muted-foreground shrink-0">{relativeTime(event.created_at)}</span>
          </div>
          <div
            className={`whitespace-pre-wrap break-words text-sm ${clampable && !expanded ? 'line-clamp-6' : ''}`}
          >
            {renderContent(event.content)}
          </div>
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
      </CardContent>
    </Card>
  );
};
