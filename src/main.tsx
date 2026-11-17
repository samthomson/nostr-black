import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// No webfont imports: the app uses the system mono stack (see index.css).

import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';

// The PWA's own update path: the build's service worker precaches the
// shell and auto-updates on every deploy (vite-plugin-pwa virtual).
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });


createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
      <App />
  </ErrorBoundary>
);
