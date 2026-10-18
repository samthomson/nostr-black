import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { ScrollToTop } from "./components/ScrollToTop";
import { AuthGate } from "./components/AuthGate";

import Index from "./pages/Index";
import { NIP19Page } from "./pages/NIP19Page";
import DebugPage from "./pages/Debug";
import CrashPage from "./pages/Crash";
import SettingsPage from "./pages/Settings";
import ConnectionsPage from "./pages/Connections";
import { FollowsPage, MutesPage } from "./pages/Lists";
import PublicFeedPage from "./pages/PublicFeed";
import PrivateFeedPage from "./pages/PrivateFeed";
import { PrivateThreadPage } from "./pages/PrivateThread";
import NotFound from "./pages/NotFound";

/** App surfaces behind the login gate: logged out redirects to the
 * landing, which returns you here after login. */
const GATED: readonly { path: string; element: ReactNode }[] = [
  { path: "/settings/*", element: <SettingsPage /> },
  { path: "/debug", element: <DebugPage /> },
  { path: "/connections", element: <ConnectionsPage /> },
  { path: "/follows", element: <FollowsPage /> },
  { path: "/mutes", element: <MutesPage /> },
  { path: "/public-feed", element: <PublicFeedPage /> },
  { path: "/private-feed", element: <PrivateFeedPage /> },
  { path: "/private-feed/:nip19", element: <PrivateThreadPage /> },
  { path: "/:nip19", element: <NIP19Page /> },
];

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/crash" element={<CrashPage />} />
        {GATED.map(({ path, element }) => (
          <Route key={path} path={path} element={<AuthGate>{element}</AuthGate>} />
        ))}
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
