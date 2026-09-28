import type { NostrEvent, NostrFilter, NostrRelayMsg } from '@nostrify/types';
import { isDesktop } from './runtime';
import { openBridge, type RelayIo } from './net';

/**
 * Minimal NIP-46 relay adapter: implements exactly the two methods
 * NConnectSigner calls — `req()` (streaming subscription) and `event()`
 * (publish). Same protocol on both runtimes: the Tauri streaming bridge on
 * desktop, a browser WebSocket on web.
 */

interface RelayAdapter {
  req: (filters: NostrFilter[], opts?: { signal?: AbortSignal }) => AsyncGenerator<NostrRelayMsg>;
  event: (event: NostrEvent, opts?: { signal?: AbortSignal }) => Promise<void>;
}

/** Fan-out so multiple waiters can watch one socket's frames. */
const frameHub = (frames: AsyncGenerator<string>) => {
  const listeners = new Set<(frame: string) => void>();
  (async () => {
    for await (const frame of frames) {
      for (const cb of listeners) cb(frame);
    }
    for (const cb of listeners) cb(''); // stream ended
  })().catch(() => {/* socket died */});
  return {
    on(cb: (frame: string) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
};

let subSeq = 0;

/** Shared implementation over any frame-carrying IO (bridge or WebSocket). */
const adapterOverIo = (io: RelayIo): RelayAdapter => {
  const hub = frameHub(io.frames);
  const send = (text: string) => io.send(text);

  return {
    async *req(filters, opts) {
      const subId = `nip46-${++subSeq}`;
      const queue: NostrRelayMsg[] = [];
      let resolveNext: (() => void) | null = null;
      let done = false;

      const off = hub.on((frame) => {
        if (!frame) {
          done = true;
          resolveNext?.();
          return;
        }
        try {
          const msg = JSON.parse(frame) as NostrRelayMsg;
          if (msg[1] === subId) {
            queue.push(msg);
            resolveNext?.();
          }
        } catch {
          // malformed frame — ignore
        }
      });

      const onAbort = () => {
        done = true;
        resolveNext?.();
      };
      opts?.signal?.addEventListener('abort', onAbort, { once: true });

      send(JSON.stringify(['REQ', subId, ...filters]));

      while (!done) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            resolveNext = r;
          });
          resolveNext = null;
        }
        while (queue.length > 0 && !done) {
          const msg = queue.shift()!;
          yield msg;
          if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') done = true;
        }
      }

      opts?.signal?.removeEventListener('abort', onAbort);
      off();
      send(JSON.stringify(['CLOSE', subId]));
    },

    async event(event, opts) {
      send(JSON.stringify(['EVENT', event]));
      // Wait briefly for the OK for this event id (best-effort, 2s).
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        const off = hub.on((frame) => {
          try {
            const msg = JSON.parse(frame) as NostrRelayMsg;
            if (msg[0] === 'OK' && msg[1] === event.id) {
              clearTimeout(timer);
              off();
              resolve();
            }
          } catch {
            // ignore
          }
        });
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    },
  };
};

const wsIo = (url: string): RelayIo => {
  const ws = new WebSocket(url);
  const queue: string[] = [];
  const pendingSends: string[] = []; // buffered until the socket opens
  let resolveNext: (() => void) | null = null;
  let closed = false;

  async function* frames(): AsyncGenerator<string> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => {
        resolveNext = r;
      });
      resolveNext = null;
    }
  }

  ws.onopen = () => {
    for (const text of pendingSends.splice(0)) ws.send(text);
  };
  ws.onmessage = (m) => {
    queue.push(m.data as string);
    resolveNext?.();
  };
  ws.onclose = () => {
    closed = true;
    resolveNext?.();
  };
  ws.onerror = () => {
    closed = true;
    resolveNext?.();
  };

  return {
    send: (text: string) => {
      if (ws.readyState === WebSocket.CONNECTING) pendingSends.push(text);
      else ws.send(text);
    },
    frames: frames(),
    close: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
};

/** Adapters stay alive for the app session (bunker connections persist). */
const adapters = new Map<string, RelayAdapter>();

const relayAdapter = (url: string): RelayAdapter => {
  const existing = adapters.get(url);
  if (existing) return existing;

  // The desktop bridge opens asynchronously; a small promise-backed proxy
  // lets callers use the adapter synchronously and delegate once connected.
  let inner: RelayAdapter | undefined;
  let ready: Promise<RelayAdapter> | undefined;
  const ensure = (): Promise<RelayAdapter> => {
    ready ??= (async () => {
      const io = isDesktop() ? (await openBridge(url)).io : wsIo(url);
      inner = adapterOverIo(io);
      return inner;
    })();
    return ready;
  };

  const adapter: RelayAdapter = {
    async *req(filters, opts) {
      yield* (await ensure()).req(filters, opts);
    },
    async event(event, opts) {
      await (await ensure()).event(event, opts);
    },
  };
  adapters.set(url, adapter);
  return adapter;
};

/** A pool-like object for NLogin.fromBunker that routes through our adapter. */
export const nip46Pool = {
  group(urls: string[]) {
    // NConnectSigner uses one relay at a time (the first in the group).
    return relayAdapter(urls[0]);
  },
  relay(url: string) {
    return relayAdapter(url);
  },
};

// Streaming bridge makes bunker login work on desktop too.
export const bunkerLoginSupported = true;
