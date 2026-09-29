import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock IntersectionObserver as a real constructor — visibility hooks call `new`.
global.IntersectionObserver = class {
  constructor(_callback: IntersectionObserverCallback) {}
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  root = null;
  rootMargin = '';
  thresholds: number[] = [];
  takeRecords = () => [];
} as unknown as typeof IntersectionObserver;

// Mock ResizeObserver as a real constructor — layout hooks call `new`.
global.ResizeObserver = class {
  constructor(_callback: ResizeObserverCallback) {}
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as unknown as typeof ResizeObserver;
/**
 * Tests never touch the network. Anything that opens a real relay socket
 * fails immediately and says which URL it tried — a suite that silently
 * connects to live relays is slow, flaky, and chatty toward real operators.
 *
 * Tests exercising the transport install their own double via
 * `vi.stubGlobal('WebSocket', …)`, which takes precedence over this.
 */
global.WebSocket = class {
  constructor(url: string) {
    throw new Error(
      `test tried to open a real relay connection: ${url}. ` +
        'stub the transport, or the relay call should not run in this test.',
    );
  }
} as unknown as typeof WebSocket;

// jsdom lacks blob URL support — media tests rely on it.
if (!('createObjectURL' in URL) || !URL.createObjectURL) {
  let n = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    value: () => `blob:mock-${++n}`,
    configurable: true,
  });
  (URL as { revokeObjectURL?: unknown }).revokeObjectURL = () => {};
}
