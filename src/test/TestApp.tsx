import { afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';
import { BrowserRouter } from 'react-router-dom';
import { NostrLoginProvider } from '@nostrify/react/login';
import { AppProvider } from '@/components/AppProvider';
import { KeystoreProvider } from '@/auth/KeystoreProvider';
import { AppConfig } from '@/contexts/AppContext';
import { UserState } from '@/contexts/UserStateContext';
import { UserStateProvider } from '@/components/UserStateProvider';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { DataProvider } from '@/data/DataProvider';
import { store } from '@/data/store';
import { scheduler } from '@/data/scheduler';
import { clearFeeds } from '@/data/feed/registry';
import { resetPersist } from '@/data/persist/persist';

afterEach(async () => {
  store.clear();
  scheduler.reset();
  clearFeeds();
  await resetPersist();
});

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
            <DataProvider>
              <BrowserRouter>
                {children}
              </BrowserRouter>
            </DataProvider>
          </NostrLoginProvider>
        </QueryClientProvider>
        </KeystoreProvider>
        </UserStateProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

export default TestApp;