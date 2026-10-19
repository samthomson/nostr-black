import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { TorGate } from './TorGate';

/**
 * Gate for app surfaces. Logged in: full Tor gate. Logged out: redirect to
 * the landing — no dead routes, no page-level login prompts.
 */
export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const { user } = useCurrentUser();

  if (!user) {
    return <Navigate to="/" replace />;
  }
  return <TorGate>{children}</TorGate>;
};
