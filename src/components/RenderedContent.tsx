import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useProfile } from '@/data/hooks/useProfile';
import { ProfileHoverCard } from '@/components/ProfileHoverCard';
import { cn } from '@/lib/utils';
import { sanitizeUrl } from '@/lib/sanitizeUrl';
import type { PrivacyGrade } from '@/lib/privacy';
import { MEDIA_URL } from '@/lib/mediaUrls';

/**
 * Note-content rendering, shared by the feed and the broadcast modal's
 * preview tab: nostr: entities (NIP-21 — @mentions render as the
 * person's name with their hover card), non-image URLs and hashtags.
 * Image URLs are skipped here — the note body hoists them into its
 * media grid — so this component renders them as inert text; callers
 * that have no media grid can pass `keepMediaUrls` to link them.
 * Never uses innerHTML — event content is untrusted (see AGENTS.md).
 */
export const RenderedContent = ({
  content,
  grade,
  keepMediaUrls = false,
}: {
  content: string;
  grade: PrivacyGrade;
  /** Link image URLs instead of dropping them (surfaces with no media grid). */
  keepMediaUrls?: boolean;
}) => (
  <>
    {content
      .split(/(nostr:[a-z0-9]+|@(?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+|https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/gu)
      .filter(Boolean)
      .filter((token) => !(token.startsWith('http') && MEDIA_URL.test(token) && !keepMediaUrls))
      .map((token, i) => (
        <ContentToken key={i} token={token} grade={grade} />
      ))}
  </>
);

/** Link/accent colour for a privacy-graded surface: maroon pops on the
 * light public surface; on dark grades the grade's own fg keeps links
 * readable. */
const refClass = (grade: PrivacyGrade): string =>
  grade === 'public' ? 'text-maroon' : 'text-privacy-private-fg';

const ContentToken = ({ token, grade }: { token: string; grade: PrivacyGrade }) => {
  if (token.startsWith('nostr:')) {
    return <NostrRef bech32={token.slice(6)} grade={grade} />;
  }
  if (/^@(npub|nprofile|note|nevent|naddr)1/.test(token)) {
    return <NostrRef bech32={token.slice(1)} grade={grade} />;
  }
  if (/^https?:\/\//.test(token)) {
    const safe = sanitizeUrl(token);
    // http/non-https links still render as text — clicking out is
    // https-only in this app, but the words aren't lost.
    if (!safe) return token;
    return (
      <a
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
      <span className={refClass(grade)}>
        {token}
      </span>
    );
  }
  return token;
};

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
