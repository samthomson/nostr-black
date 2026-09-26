import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Newspaper, Settings } from "lucide-react";

import { ScrollToTop } from "./components/ScrollToTop";
import { LoginArea } from "@/components/auth/LoginArea";
import { DebugPanel } from "@/components/DebugPanel";
import { useState } from "react";

import Index from "./pages/Index";
import { NIP19Page } from "./pages/NIP19Page";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound";

/**
 * App template: menu on the left, content in the main area. Every logged-in
 * surface renders inside this shell.
 */
const Shell = ({ children }: { children: React.ReactNode }) => {
  const [debugOpen, setDebugOpen] = useState(false);
  const { pathname } = useLocation();

  const navItem = (to: string, icon: React.ReactNode, label: string) => (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium hover:bg-accent ${pathname === to ? 'bg-accent' : ''}`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r p-4 md:flex">
        <Link to="/" className="mb-4 px-2 font-semibold tracking-tight">nostr.black</Link>
        {navItem('/', <Newspaper className="size-4" />, 'your feed')}
        {navItem('/settings', <Settings className="size-4" />, 'settings')}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
            <Link to="/" className="font-semibold tracking-tight md:hidden">nostr.black</Link>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDebugOpen(!debugOpen)}
                aria-label="toggle debug panel"
                className="text-muted-foreground rounded-md p-2 hover:bg-accent"
              >
                <Settings className="size-4" />
              </button>
              <LoginArea className="max-w-60" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-xl p-4">{children}</main>
      </div>

      <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
    </div>
  );
};

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export { Shell };
export default AppRouter;
