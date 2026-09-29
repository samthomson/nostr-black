import { useCurrentUser } from '@/hooks/useCurrentUser';
import { TorGate } from './TorGate';

/**
 * Gate for authenticated surfaces. Logged in: the full Tor gate (network
 * use ahead). Logged out: the content renders ungated only where it makes
 * no relay queries (settings, debug); querying surfaces (NIP-19 routes)
 * fall through to the Tor gate too — the landing page is the single place
 * a logged-out visitor ever meets the tor warning.
 */
export const AuthGate = ({ network, children }: { network?: boolean; children: React.ReactNode }) => {
  const { user } = useCurrentUser();
  if (user || network) return <TorGate>{children}</TorGate>;
  return <>{children}</>;
};
