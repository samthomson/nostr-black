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
  it('is true when the https onion probe settles — only tor routes onions', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, type: 'opaque' });

    expect(await isTor()).toBe(true);
    expect(mockFetch.mock.calls[0][0]).toContain('.onion');
    expect(mockFetch.mock.calls[0][0]).toMatch(/^https:/); // https page can't fetch http
  });

  it('is false when the probe fails at the network level (no tor)', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await isTor()).toBe(false);
  });

  it('is false when the probe times out — unconfirmed is not on-tor', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'TimeoutError'));

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
