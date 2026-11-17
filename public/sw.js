/**
 * nostr.black service worker — the installed-PWA update path, hand-rolled
 * because build-time PWA plugins fight the bundler. Two rules:
 *
 * - Navigations (the shell) are network-first: every launch revalidates
 *   index.html, so a deploy can never strand the app on an entry document
 *   whose fingerprinted assets no longer exist. Offline falls back to the
 *   cached shell.
 * - /assets/* are cache-first: fingerprinted, immutable by construction —
 *   old copies stay valid forever, which keeps a cached shell coherent
 *   even offline.
 *
 * No precache manifest, no build coupling: sw.js itself is served with
 * short cache headers and its byte-diff is the update signal — a new
 * deploy swaps it in via skipWaiting + clients.claim below.
 */

const ASSETS = `${self.location.origin}/assets/`;
const SHELL_CACHE = 'shell-v1';
const ASSET_CACHE = 'assets-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
};

const networkFirstShell = async (request) => {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch {
    const shell = await cache.match('/');
    if (shell) return shell;
    throw new Error('offline and no cached shell');
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirstShell(request));
  }
});
