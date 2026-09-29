import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";
import { AuthGate } from "./components/AuthGate";

import Index from "./pages/Index";
import { NIP19Page } from "./pages/NIP19Page";
import DebugPage from "./pages/Debug";
import CrashPage from "./pages/Crash";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound";
export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/settings" element={<AuthGate><SettingsPage /></AuthGate>} />
        <Route path="/debug" element={<AuthGate><DebugPage /></AuthGate>} />
        <Route path="/crash" element={<CrashPage />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<AuthGate network><NIP19Page /></AuthGate>} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
