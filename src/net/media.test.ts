import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Desktop path active for these tests.
vi.mock('@/net/runtime', () => ({ isDesktop: () => true }));

import { invoke } from '@tauri-apps/api/core';


vi.mock('@tauri-apps/api/core', () => ({
  // 1 byte of payload per fetch so tests assert byte accounting.
  invoke: vi.fn(async () => ({ mime: 'image/png', data: 'QQ==' })),
}));

import {
  fetchAssetUrl,
  mediaCacheBytes,
  setMediaCacheMaxBytes,
  clearMediaCache,
} from './media';

// jsdom lacks createObjectURL — stub it.
let blobSeq = 0;
Object.defineProperty(URL, 'createObjectURL', {
  get: () => () => `blob:mock-${++blobSeq}`,
  configurable: true,
});
(URL as { revokeObjectURL?: unknown }).revokeObjectURL = () => {};

describe('media cache (memory + IndexedDB)', () => {
  beforeEach(async () => {
    await clearMediaCache();
    await setMediaCacheMaxBytes(1024 * 1024 * 1024);
    vi.mocked(invoke).mockClear();
  });

  it('caches a fetched asset and counts its bytes', async () => {
    await fetchAssetUrl('https://img.example/a.png');
    expect(mediaCacheBytes()).toBe(1);
    await fetchAssetUrl('https://img.example/a.png');
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1); // memory hit — no refetch
    expect(mediaCacheBytes()).toBe(1);
  });

  it('survives a session restart via IndexedDB', async () => {
    await fetchAssetUrl('https://img.example/persist.png');
    // Simulate restart: memory layer gone (evict-all via 1MB budget leaves
    // IDB intact is not expressible publicly — instead clear only memory by
    // re-importing the module fresh).
    vi.resetModules();
    const fresh = await import('./media');
    const url = await fresh.fetchAssetUrl('https://img.example/persist.png');
    expect(url).toMatch(/^blob:/);
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1); // served from IDB, not network
  });

  it('never evicts avatars to make room for media', async () => {
    await clearMediaCache();
    await setMediaCacheMaxBytes(1024 * 1024); // 1 MB total
    await fetchAssetUrl('https://img.example/face.png', 'avatar');
    // Media bucket budget is ~1MB-64MB → clamped to 1MB min, but avatar has
    // its own protected budget: filling media can't touch the avatar entry.
    for (let i = 0; i < 3; i++) {
      await fetchAssetUrl(`https://img.example/big-${i}.png`, 'media');
    }
    // The avatar is still cached (no refetch → invoke still at 4 calls).
    await fetchAssetUrl('https://img.example/face.png', 'avatar');
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(4);
  });

  it('forgetting failures after clear lets a retry run', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('boom'));
    await expect(fetchAssetUrl('https://img.example/bad.png')).rejects.toThrow('boom');
    await expect(fetchAssetUrl('https://img.example/bad.png')).rejects.toThrow('failed earlier');
    await clearMediaCache();
    await expect(fetchAssetUrl('https://img.example/bad.png')).resolves.toMatch(/^blob:/);
  });
});
