import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TorGate } from '@/components/TorGate';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <TorGate>
      <App />
    </TorGate>
  </ErrorBoundary>
);
