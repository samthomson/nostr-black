import { memo, useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { FollowButton } from '@/components/FollowButton';
import { ConnectButton } from '@/components/ConnectButton';
import { useProfile } from '@/data/hooks/useProfile';
import { profileHref, npubOf } from '@/lib/format';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import { PRIVACY } from '@/lib/privacy';
import { useAsset } from '@/hooks/useAsset';
import { cn } from '@/lib/utils';

/**
 * Ditto-style profile preview: hovering an author name in the feed opens
 * a landscape card — banner sliver, avatar, identity, bio — with an action
 * footer (follow now; more to come). The body mounts only while the card
 * is open, so scrolling past a name fetches nothing.
 */
export const ProfileHoverCard = memo(function ProfileHoverCard({ pubkey, children }: {
  pubkey: string;
  children: React.ReactNode;
}) {
  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        sideOffset={8}
        className={cn('w-96 overflow-hidden rounded-sm border-border p-0', PRIVACY.public.surface)}
        onClick={(e) => e.stopPropagation()}
      >
        <ProfileHoverCardBody pubkey={pubkey} />
      </HoverCardContent>
    </HoverCard>
  );
});

/** A thin banner sliver, muted when absent — height, not a full banner. */
const BannerSliver = memo(function BannerSliver({ url }: { url: string | undefined }) {
  const { url: src } = useAsset(url, 'media');
  return (
    <div className="bg-muted h-15 w-full overflow-hidden">
      {src && <img src={src} alt="" className="size-full object-cover" />}
    </div>
  );
});

/** Middle-clipped npub with a copy flash — `aaaa…bbbb` plus copy icon. */
const NpubLine = memo(function NpubLine({ pubkey }: { pubkey: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(npubOf(pubkey));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [pubkey]);
  return (
    <button
      type="button"
      onClick={copy}
      className="text-muted-foreground flex w-full max-w-full min-w-0 cursor-pointer items-center gap-1 font-mono text-[11px] hover:text-foreground"
      aria-label="copy npub"
    >
      <span className="truncate">{npubOf(pubkey)}</span>
      {copied ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
    </button>
  );
});

/** Card body — mounted only while the hover card is open. */
const ProfileHoverCardBody = memo(function ProfileHoverCardBody({ pubkey }: { pubkey: string }) {
  const { metadata, pending } = useProfile(pubkey);
  const displayName = metadata?.display_name || metadata?.name;
  const href = profileHref(pubkey);
  const name = displayName ?? `${npubOf(pubkey).slice(0, 10)}…`;

  return (
    <div>
      <BannerSliver url={sanitizeUrl(metadata?.banner)} />
      <div className="relative px-3 pb-2">
        <div className="-mt-[25px] mb-1 flex items-end gap-2">
          {href ? (
            <Link to={href} className="w-fit shrink-0">
              <ProfileAvatar
                pubkey={pubkey}
                metadata={metadata}
                waitingMetadata={pending}
                className="border-background size-[50px] border-2"
              />
            </Link>
          ) : (
            <ProfileAvatar
              pubkey={pubkey}
              metadata={metadata}
              waitingMetadata={pending}
              className="border-background size-[50px] border-2"
            />
          )}
          {href ? (
            <Link to={href} className="min-w-0 truncate pb-0.5 text-sm font-semibold hover:underline">
              {name}
            </Link>
          ) : (
            <span className="min-w-0 truncate pb-0.5 text-sm font-semibold">{name}</span>
          )}
        </div>
        {metadata?.nip05 && (
          <p className="text-muted-foreground truncate text-xs">{metadata.nip05}</p>
        )}
        <NpubLine pubkey={pubkey} />
        {metadata?.about && (
          <p className="text-muted-foreground mt-1 line-clamp-1 truncate whitespace-pre-wrap break-words text-xs leading-snug">
            {metadata.about}
          </p>
        )}
      </div>
      {/* Action row: follow (public), connect (private). */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <FollowButton pubkey={pubkey} compact />
        <ConnectButton pubkey={pubkey} compact />
      </div>
    </div>
  );
});
