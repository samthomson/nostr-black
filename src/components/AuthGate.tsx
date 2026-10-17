import { Navigate, useLocation } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { TorGate } from './TorGate';

/**
 * Gate for app surfaces. Logged in: full Tor gate. Logged out: redirect to
 * the landing — no dead routes, no page-level login prompts. The intended
 * path rides along in location state, and the landing returns you there
 * after login.
 */
export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const { user } = useCurrentUser();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />;
  }
  return <TorGate>{children}</TorGate>;
};
