import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isTor, httpEgress, egressLog, logEgress } from './net';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  egressLog.length = 0;
});

afterEach(() => {
  mockFetch.mockReset();
});

describe('isTor', () => {
  it('is true when any https onion probe settles — only tor routes onions', async () => {
    const hanging = Promise.withResolvers<Response>();
    mockFetch.mockImplementation((url: string) =>
      url.includes('facebook') ? Promise.resolve({ ok: true, type: 'opaque' }) : hanging.promise,
    );

    expect(await isTor()).toBe(true);
    expect(mockFetch.mock.calls.every(([url]) => url.match(/^https:.*\.onion\//))).toBe(true);
  });

  it('is false when every probe fails at the network level (no tor)', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await isTor()).toBe(false);
  });

  it('is false when every probe times out — unconfirmed is not on-tor', async () => {
    mockFetch.mockRejectedValue(new DOMException('aborted', 'TimeoutError'));

    expect(await isTor()).toBe(false);
  });
});

describe('egress log', () => {
  it('httpEgress records the url it fetched', async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await httpEgress('https://example.com/info');

    expect(egressLog[0]).toMatchObject({ kind: 'http', url: 'https://example.com/info' });
  });

  it('is a ring buffer capped at 100 entries', () => {
    for (let i = 0; i < 120; i++) {
      logEgress('ws', `wss://relay-${i}.example/`);
    }

    expect(egressLog).toHaveLength(100);
    // Newest first — the earliest entries were evicted.
    expect(egressLog[0].url).toBe('wss://relay-119.example/');
    expect(egressLog.at(-1)?.url).toBe('wss://relay-20.example/');
  });
});
