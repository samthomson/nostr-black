import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { isTor, httpEgress, egressLog, logEgress } from './net';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Tiny fixture list so membership logic is deterministic.
vi.mock('./tor-exits.json', () => ({ default: ['1.2.3.4', '9.9.9.9'] }));

beforeEach(() => {
  egressLog.length = 0;
});

afterEach(() => {
  mockFetch.mockReset();
});

/** Route the fetch mock: first onion probe, then ipify fallback. */
const onion = (impl: () => Promise<unknown>) => mockFetch.mockImplementationOnce(impl);

describe('isTor', () => {
  it('is true when the onion probe settles — tor is the only thing that answers onions', async () => {
    onion(() => Promise.resolve({ ok: true, type: 'opaque' }));

    expect(await isTor()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('.onion');
  });

  it('is false when the onion probe fails at the network level', async () => {
    onion(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await isTor()).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the exit list when the probe times out', async () => {
    onion(() => Promise.reject(new DOMException('aborted', 'TimeoutError')));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ip: '9.9.9.9' }) });

    expect(await isTor()).toBe(true);
  });

  it('fallback returns false for a non-exit ip', async () => {
    onion(() => Promise.reject(new DOMException('aborted', 'TimeoutError')));
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ip: '8.8.8.8' }) });

    expect(await isTor()).toBe(false);
  });

  it('fallback throws on a non-ok echo instead of guessing', async () => {
    onion(() => Promise.reject(new DOMException('aborted', 'TimeoutError')));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(isTor()).rejects.toThrow('IP echo failed: 500');
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
