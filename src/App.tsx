// NOTE: This file should normally not be modified unless you are adding a provider.
// To add new routes, edit the AppRouter.tsx file.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHead, UnheadProvider } from '@unhead/react/client';
import { InferSeoMetaPlugin } from 'unhead/plugins';
import { Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeystoreProvider } from '@/auth/KeystoreProvider';
import { AppProvider } from '@/components/AppProvider';
import { UserStateProvider } from '@/components/UserStateProvider';
import { AppConfig } from '@/contexts/AppContext';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { FEED_KINDS } from '@/data/feed/spec';
import { QueryDevtools } from '@/components/QueryDevtools';
import { BetaBanner } from '@/components/BetaBanner';
import { DataProvider } from '@/data/DataProvider';
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
  imageCompression: true,
  feedKinds: [...FEED_KINDS],
  defaultReaction: '+',
  mediaCacheMaxMb: 1024,
  mediaMaxDownloadMb: 32,
};

export function App() {
  return (
    <UnheadProvider head={head}>
      <AppProvider storageKey="nostr:app-config/2" defaultConfig={defaultConfig}>
        <KeystoreProvider>
        <UserStateProvider storageKey="nostr:user-state">
        <QueryClientProvider client={queryClient}>
          <DataProvider>
            <AppRoot />
          </DataProvider>
          <QueryDevtools />
        </QueryClientProvider>
        </UserStateProvider>
        </KeystoreProvider>
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
  return (
    <TooltipProvider>
      <Toaster />
      <div className="flex h-dvh flex-col">
        <BetaBanner />
        <div className="min-h-0 flex-1">
          <Suspense>
            <AppRouter />
          </Suspense>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default App;
