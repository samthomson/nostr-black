import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// No webfont imports: the app uses the system mono stack (see index.css).

import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';
import './index.css';
// The installed-PWA update path: the service worker (public/sw.js)
// keeps the shell network-first and assets cache-first, so deploys can
// never strand the app on assets that no longer exist. Production only
// — the dev server owns its own asset pipeline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}


createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
      <App />
  </ErrorBoundary>
);
