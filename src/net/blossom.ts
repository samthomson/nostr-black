/**
 * Blossom (BUD-01) upload client — the only path image bytes leave the
 * app. Desktop goes through the Rust `blossom_put` command so uploads
 * ride the same route as relay traffic (Tor or direct); web speaks plain
 * fetch. Auth is a kind-24242 event signed by the session key, per BUD-01.
 */
import { invoke } from '@tauri-apps/api/core';
import { finalizeEvent } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NostrEvent } from '@nostrify/nostrify';
import { isDesktop } from './runtime';

export interface UploadedBlob {
  /** SHA-256 of the uploaded bytes — the server must confirm ours. */
  sha256: string;
  /** Where the blob lives: the descriptor's url, or <server>/<sha256>. */
  url: string;
  /** Blob size in bytes, per the descriptor. */
  size: number;
}

/** The kind-24242 auth event (BUD-01): t=upload, x=<sha256>, 5-min expiry. */
export const blossomAuth = (sk: Uint8Array, sha256hex: string): NostrEvent =>
  finalizeEvent({
    kind: 24242,
    content: '',
    tags: [
      ['t', 'upload'],
      ['expiration', String(Math.floor(Date.now() / 1000) + 300)],
      ['x', sha256hex],
    ],
    created_at: Math.floor(Date.now() / 1000),
  }, sk);

/** base64 of arbitrary length — String.fromCharCode(...bytes) overflows
 * the argument stack at ~64KB, so encode in 32KB chunks. */
const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

interface BlobDescriptor {
  sha256?: string;
  url?: string;
  size?: number;
}

/**
 * PUT `bytes` to `<server>/upload`. The server's descriptor must confirm
 * our sha256 — a mismatch means corrupted or substituted storage, and is
 * an error, not a warning. Errors surface to the caller.
 */
export const blossomUpload = async (
  bytes: Uint8Array,
  type: string,
  server: string,
  sk: Uint8Array,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadedBlob> => {
  const sha256hex = bytesToHex(sha256(bytes));
  const authorization = `Nostr ${btoa(JSON.stringify(blossomAuth(sk, sha256hex)))}`;
  const endpoint = `${server.replace(/\/+$/, '')}/upload`;

  let raw: string;
  if (isDesktop()) {
    raw = atob(await invoke<string>('blossom_put', {
      url: endpoint,
      authorization,
      contentType: type,
      body: toBase64(bytes),
    }));
  } else {
    // XHR, not fetch: fetch cannot report upload progress at all, and
    // iOS Safari is unreliable PUTting raw typed-array bodies — the
    // Blob wrapper is the portable shape on every engine.
    raw = await xhrUpload(endpoint, authorization, type, bytes, onProgress);
  }

  const descriptor = (() => {
    try {
      return JSON.parse(raw) as BlobDescriptor;
    } catch {
      return undefined;
    }
  })();
  if (!descriptor) throw new Error('blossom server returned a non-JSON descriptor');
  if (descriptor.sha256 !== sha256hex) {
    throw new Error(`blossom sha256 mismatch: sent ${sha256hex}, stored ${descriptor.sha256 ?? 'none'}`);
  }
  return {
    sha256: sha256hex,
    url: descriptor.url ?? `${server.replace(/\/+$/, '')}/${sha256hex}`,
    size: descriptor.size ?? bytes.length,
  };
};

/** One PUT via XHR with upload progress. The body is a Blob — the
 * typed-array-to-BodyInit coercion is where mobile Safari breaks. */
const xhrUpload = (
  endpoint: string,
  authorization: string,
  type: string,
  bytes: Uint8Array,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> => {
  const { promise, reject, resolve } = Promise.withResolvers<string>();
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', endpoint);
  xhr.setRequestHeader('Authorization', authorization);
  xhr.setRequestHeader('Content-Type', type);
  // Match the desktop transport's 300s cap (src-tauri/src/main.rs): a
  // hung server must surface as a retryable timeout, not an infinite
  // spinner the only escape from which is cancel.
  xhr.timeout = 300_000;
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) onProgress?.(e.loaded, e.total);
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      resolve(xhr.responseText);
    } else {
      reject(new Error(`blossom upload failed: ${xhr.status} ${xhr.responseText.slice(0, 200)}`));
    }
  };
  xhr.onerror = () => reject(new Error('upload failed — network error (offline, blocked, or the server is unreachable)'));
  xhr.ontimeout = () => reject(new Error('upload timed out'));
  xhr.send(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  return promise;
};

/** Fetch raw bytes from a blossom server (or any https URL) — the
 * private-media path for ciphertext downloads. Web: fetch, with
 * Content-Length pre-checked and the body capped at `maxBytes` (the
 * user's mediaMaxDownloadMb setting threads through here). Desktop:
 * the existing GET command, whose Rust side enforces its own 32 MB
 * const cap (src-tauri/src/main.rs). */
export const blossomBytes = async (url: string, maxBytes = 32 * 1024 * 1024): Promise<Uint8Array> => {
  if (!isDesktop()) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    // Honest servers declare the size up front — reject before reading.
    const declared = Number(res.headers.get('content-length') ?? Number.NaN);
    if (declared > maxBytes) {
      throw new Error(`media too large: ${declared} bytes exceeds ${maxBytes}`);
    }
    const ct = new Uint8Array(await res.arrayBuffer() as ArrayBuffer);
    // Lying or length-free servers are caught by the body itself.
    if (ct.length > maxBytes) {
      throw new Error(`media too large: ${ct.length} bytes exceeds ${maxBytes}`);
    }
    return ct;
  }
  const { data } = await invoke<{ mime: string; data: string }>('fetch_asset', { url });
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
};
