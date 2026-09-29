import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isTor, egressLog, logEgress, resetTorProbe } from './net';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  egressLog.length = 0;
  resetTorProbe();
  mockFetch.mockReset();
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

  it('does not re-probe after the first answer', async () => {
    mockFetch.mockResolvedValue({ ok: true, type: 'opaque' });
    expect(await isTor()).toBe(true);
    mockFetch.mockClear();
    expect(await isTor()).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('egress log', () => {
  it('is a ring buffer capped at 200 entries', () => {
    for (let i = 0; i < 220; i++) {
      logEgress('ws', `wss://relay-${i}.example/`);
    }

    expect(egressLog).toHaveLength(200);
    // Newest first — the earliest entries were evicted.
    expect(egressLog[0].url).toBe('wss://relay-219.example/');
    expect(egressLog.at(-1)?.url).toBe('wss://relay-20.example/');
  });
});
