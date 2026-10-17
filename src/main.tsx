import { createRoot } from 'react-dom/client';

// Import polyfills first
import './lib/polyfills.ts';

// No webfont imports: the app uses the system mono stack (see index.css).

import { ErrorBoundary } from '@/components/ErrorBoundary';
import App from './App.tsx';
import './index.css';


createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
      <App />
  </ErrorBoundary>
);
