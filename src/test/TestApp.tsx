import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';
import { BrowserRouter } from 'react-router-dom';
import { NostrLoginProvider } from '@nostrify/react/login';
import { useNostrSync } from '@/hooks/useNostrSync';
import { AppProvider } from '@/components/AppProvider';
import { KeystoreProvider } from '@/auth/KeystoreProvider';
import { AppConfig } from '@/contexts/AppContext';
import { UserState } from '@/contexts/UserStateContext';
import { UserStateProvider } from '@/components/UserStateProvider';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';

interface TestAppProps {
  children: React.ReactNode;
  /** Seed for synced user nostr state (follows, relay list). */
  userState?: Partial<UserState>;
}

export function TestApp({ children, userState }: TestAppProps) {
  const head = createHead();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const defaultConfig: AppConfig = {
    theme: 'dark',
    discoveryRelays: DEFAULT_DISCOVERY_RELAYS,
    torEnabled: true,
    mediaEnabled: true,
    mediaCacheMaxMb: 1024,
  };

  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey='test-app-config' defaultConfig={defaultConfig}>
        <UserStateProvider storageKey='test-user-state' initialState={userState}>
        <KeystoreProvider>
        <QueryClientProvider client={queryClient}>
          <NostrLoginProvider storageKey='test-login'>
              <BrowserRouter>
                <TestAppRoot>{children}</TestAppRoot>
              </BrowserRouter>
          </NostrLoginProvider>
        </QueryClientProvider>
        </KeystoreProvider>
        </UserStateProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

/** Runs the global sync hook inside the provider tree, then renders the test subject. */
const TestAppRoot = ({ children }: { children: React.ReactNode }) => {
  useNostrSync();
  return <>{children}</>;
};

export default TestApp;