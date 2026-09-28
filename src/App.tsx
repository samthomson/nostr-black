// NOTE: This file should normally not be modified unless you are adding a provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from 'unhead/plugins';
import { Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NostrLoginProvider } from '@nostrify/react/login';
import { KeystoreProvider } from '@/auth/KeystoreProvider';
import { AppProvider } from '@/components/AppProvider';
import { UserStateProvider } from '@/components/UserStateProvider';
import { AppConfig } from '@/contexts/AppContext';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { QueryDevtools } from '@/components/QueryDevtools';
import { useNostrSync } from '@/hooks/useNostrSync';
import AppRouter from './AppRouter';

const head = createHead({
  plugins: [
    InferSeoMetaPlugin(),
  ],
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60000, // 1 minute
      gcTime: Infinity,
    },
  },
});

const defaultConfig: AppConfig = {
  theme: "dark",
  discoveryRelays: DEFAULT_DISCOVERY_RELAYS,
  torEnabled: true,
  mediaEnabled: true,
  mediaCacheMaxMb: 1024,
};

export function App() {
  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config/2" defaultConfig={defaultConfig}>
        <UserStateProvider storageKey="nostr:user-state">
        <KeystoreProvider>
        <QueryClientProvider client={queryClient}>
          <NostrLoginProvider storageKey='nostr:login'>
              <AppRoot />
          </NostrLoginProvider>
          <QueryDevtools />
        </QueryClientProvider>
        </KeystoreProvider>
        </UserStateProvider>
      </AppProvider>
    </UnheadProvider>
  );
}

/**
 * The app inside every provider: global sync effects (NIP-65 relay list,
 * NIP-42 auth signer) hang off this root, and the real surfaces render
 * below it. Replaces the old null-rendering NostrSync mount slot.
 */
const AppRoot = () => {
  useNostrSync();
  return (
    <TooltipProvider>
      <Toaster />
      <Suspense>
        <AppRouter />
      </Suspense>
    </TooltipProvider>
  );
};

export default App;
