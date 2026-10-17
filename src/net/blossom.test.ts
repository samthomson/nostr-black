import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { blossomAuth, blossomUpload } from './blossom';

const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('blossomAuth', () => {
  it('is a valid kind-24242 upload event: t, x, near-future expiry', () => {
    const sk = generateSecretKey();
    const sha256hex = bytesToHex(sha256(bytes(32)));
    const auth = blossomAuth(sk, sha256hex);
    expect(auth.kind).toBe(24242);
    expect(auth.pubkey).toBe(getPublicKey(sk));
    expect(auth.tags).toContainEqual(['t', 'upload']);
    expect(auth.tags).toContainEqual(['x', sha256hex]);
    const expiration = Number(auth.tags.find(([n]) => n === 'expiration')?.[1]);
    expect(expiration).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(expiration).toBeLessThan(Math.floor(Date.now() / 1000) + 3600);
    expect(verifyEvent(auth)).toBe(true);
  });
});

describe('blossomUpload', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    return () => vi.unstubAllGlobals();
  });

  const respond = (status: number, body: unknown): void => {
    fetchMock.mockResolvedValue(new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status },
    ));
  };

  it('PUTs the bytes with the auth header and returns the descriptor', async () => {
    const sk = generateSecretKey();
    const payload = bytes(64);
    const sha256hex = bytesToHex(sha256(payload));
    respond(200, { sha256: sha256hex, url: 'https://srv/abc', size: 64 });

    const blob = await blossomUpload(payload, 'image/webp', 'https://srv/', sk);
    expect(blob).toEqual({ sha256: sha256hex, url: 'https://srv/abc', size: 64 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://srv/upload');
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Nostr /);
    expect(init.body).toEqual(payload);
  });

  it('falls back to <server>/<sha256> when the descriptor carries no url', async () => {
    const sk = generateSecretKey();
    const payload = bytes(16);
    const blob = { sha256: bytesToHex(sha256(payload)) };
    respond(200, blob);
    const out = await blossomUpload(payload, 'image/png', 'https://srv/', sk);
    expect(out.url).toBe(`https://srv/${blob.sha256}`);
  });

  it('rejects a server that stored different bytes — corruption surfaces', async () => {
    const sk = generateSecretKey();
    respond(200, { sha256: 'f'.repeat(64) });
    await expect(blossomUpload(bytes(16), 'image/png', 'https://srv/', sk))
      .rejects.toThrow('sha256 mismatch');
  });

  it('rejects non-2xx and non-JSON responses', async () => {
    const sk = generateSecretKey();
    const sha256hex = bytesToHex(sha256(bytes(16)));
    respond(402, 'payment required');
    await expect(blossomUpload(bytes(16), 'image/png', 'https://srv/', sk)).rejects.toThrow('402');
    respond(200, 'not json');
    await expect(blossomUpload(bytes(16), 'image/png', 'https://srv/', sk)).rejects.toThrow('non-JSON');
    void sha256hex;
  });
});
