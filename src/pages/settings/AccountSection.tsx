import { nip19 } from 'nostr-tools';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Section } from './Section';

export const AccountSection = () => {
  const { user } = useCurrentUser();
  if (!user) return null;

  const npub = nip19.npubEncode(user.pubkey);

  return (
    <Section title="account">
      <p className="text-muted-foreground text-xs">
        logged in as {npub.slice(0, 12)}… —{' '}
        <Link to={`/${npub}`} className="underline underline-offset-2">
          your profile
        </Link>
      </p>
    </Section>
  );
};
