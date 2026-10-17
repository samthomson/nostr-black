import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { makeRumor, replyCekOf } from './feedEncryption';
import { blossomBytes } from '@/net/blossom';
import {
  decryptImage,
  encryptImage,
  loadPrivateImage,
  mediaImagesOf,
  mediaTags,
  mintConversation,
  remintRumor,
} from './fileMessage';

vi.mock('@/net/blossom', () => ({ blossomBytes: vi.fn() }));
const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i % 251);
const staged = { mime: 'image/webp', x: '1'.repeat(64), ox: '2'.repeat(64), nonce: '3'.repeat(24) };
const uploaded = { ...staged, url: 'https://blossom.example/abc' };

describe('fileMessage', () => {
  it('round-trips bytes under the conversation key', () => {
    const replyCek = randomBytes(32);
    const plain = bytes(1024);
    const encrypted = encryptImage(replyCek, plain);
    expect(encrypted.ox).toBe(bytesToHex(sha256(plain)));
    expect(encrypted.x).toBe(bytesToHex(sha256(encrypted.ct)));
    expect(encrypted.ct.length).toBeGreaterThan(plain.length); // GCM tag
    expect(encrypted.nonce).toHaveLength(24); // 12 bytes, hex
    expect(decryptImage(bytesToHex(replyCek), encrypted.nonce, encrypted.ct)).toEqual(plain);
  });

  it('only the conversation key opens the image', () => {
    const encrypted = encryptImage(randomBytes(32), bytes(64));
    expect(() => decryptImage(bytesToHex(randomBytes(32)), encrypted.nonce, encrypted.ct)).toThrow();
  });

  it('draws a fresh nonce per image: same plaintext and key, different ciphertext', () => {
    const replyCek = randomBytes(32);
    const plain = bytes(32);
    const a = encryptImage(replyCek, plain);
    const b = encryptImage(replyCek, plain);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.x).not.toBe(b.x);
    expect(decryptImage(bytesToHex(replyCek), a.nonce, a.ct)).toEqual(plain);
    expect(decryptImage(bytesToHex(replyCek), b.nonce, b.ct)).toEqual(plain);
  });

  it('mints a conversation and remints it with content and media tags', () => {
    const pk = 'a'.repeat(64);
    const { rumor, replyCek } = mintConversation(pk);
    expect(rumor.content).toBe('');
    expect(replyCekOf(rumor)).toEqual(replyCek);

    const reminted = remintRumor(rumor, { content: 'look', tags: [...rumor.tags, ...mediaTags([uploaded], replyCek)] });
    expect(reminted.id).not.toBe(rumor.id);
    // the id is the real hash of the changed template, and the key survives
    expect(replyCekOf(reminted)).toEqual(replyCek);
    expect(mediaImagesOf(reminted)).toEqual([
      { url: uploaded.url, mime: uploaded.mime, key: bytesToHex(replyCek), nonce: staged.nonce, x: staged.x, ox: staged.ox },
    ]);
  });

  it('media tags: one imeta per image, in order — url, x, ox, m, algorithm, key, nonce', () => {
    const cek = randomBytes(32);
    const second = { ...staged, url: 'https://blossom.example/two' };
    expect(mediaTags([], cek)).toEqual([]);
    expect(mediaTags([uploaded, second], cek)).toEqual([
      ['imeta', `url ${uploaded.url}`, `x ${staged.x}`, `ox ${staged.ox}`, `m ${staged.mime}`, 'encryption-algorithm aes-gcm', `decryption-key ${bytesToHex(cek)}`, `decryption-nonce ${staged.nonce}`],
      ['imeta', `url ${second.url}`, `x ${staged.x}`, `ox ${staged.ox}`, `m ${staged.mime}`, 'encryption-algorithm aes-gcm', `decryption-key ${bytesToHex(cek)}`, `decryption-nonce ${staged.nonce}`],
    ]);
  });

  it('mediaImagesOf reads imeta back, skipping unencrypted, malformed, and off-scheme tags', () => {
    const pk = 'a'.repeat(64);
    const cekBytes = randomBytes(32);
    // a rumor without media tags has no images
    expect(mediaImagesOf(makeRumor(pk, 'look').rumor)).toEqual([]);

    const { rumor } = makeRumor(pk, 'with pictures', [
      ['e', 'c'.repeat(64)], // the parent reply marker — not an image
      mediaTags([uploaded], cekBytes)[0]!,
      ['imeta', 'url https://blossom.example/plain', 'm image/png'], // unencrypted media: no decryption fields
      ['imeta', `url https://blossom.example/no-mime`, `decryption-key ${bytesToHex(cekBytes)}`, `decryption-nonce ${staged.nonce}`], // no mime
      ['imeta', `url https://blossom.example/no-key`, `m ${staged.mime}`, `decryption-nonce ${staged.nonce}`], // no key
      ['imeta', `url https://blossom.example/no-nonce`, `m ${staged.mime}`, `decryption-key ${bytesToHex(cekBytes)}`], // no nonce
      ['imeta', `url http://blossom.example/insecure`, `m ${staged.mime}`, `decryption-key ${bytesToHex(cekBytes)}`, `decryption-nonce ${staged.nonce}`], // not https
    ]);
    expect(mediaImagesOf(rumor)).toEqual([
      { url: uploaded.url, mime: uploaded.mime, key: bytesToHex(cekBytes), nonce: staged.nonce, x: staged.x, ox: staged.ox },
    ]);
  });

  it('loads: fetches, verifies x, decrypts to a blob url', async () => {
    const replyCek = randomBytes(32);
    const plain = bytes(512);
    const encrypted = encryptImage(replyCek, plain);
    vi.mocked(blossomBytes).mockResolvedValue(encrypted.ct);
    const { blobUrl, mime } = await loadPrivateImage({
      url: 'https://blossom.example/x', mime: 'image/webp', key: bytesToHex(replyCek),
      x: encrypted.x, ox: encrypted.ox, nonce: encrypted.nonce,
    });
    expect(mime).toBe('image/webp');
    expect(blobUrl.startsWith('blob:')).toBe(true);
  });

  it('throws on an integrity failure — substituted bytes never render', async () => {
    const replyCek = randomBytes(32);
    const encrypted = encryptImage(replyCek, bytes(512));
    vi.mocked(blossomBytes).mockResolvedValue(bytes(512)); // wrong ciphertext
    await expect(loadPrivateImage({
      url: 'https://blossom.example/x', mime: 'image/webp', key: bytesToHex(replyCek),
      x: encrypted.x, ox: encrypted.ox, nonce: encrypted.nonce,
    })).rejects.toThrow('integrity');
  });

  it('throws when GCM cannot open tampered ciphertext', async () => {
    const replyCek = randomBytes(32);
    const encrypted = encryptImage(replyCek, bytes(512));
    const tampered = Uint8Array.from(encrypted.ct);
    tampered[0] ^= 1;
    // x matches the tampered bytes: the tamper is caught by the AEAD itself
    vi.mocked(blossomBytes).mockResolvedValue(tampered);
    await expect(loadPrivateImage({
      url: 'https://blossom.example/x', mime: 'image/webp', key: bytesToHex(replyCek),
      x: bytesToHex(sha256(tampered)), ox: encrypted.ox, nonce: encrypted.nonce,
    })).rejects.toThrow();
  });
});
