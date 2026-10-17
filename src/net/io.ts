/**
 * The two raw transports a relay connection can run over: the Tauri
 * streaming bridge on desktop (arti/Tor in Rust) and a browser WebSocket on
 * web. Both expose the same duplex frame interface; everything above this
 * file is transport-agnostic.
 */

import { isDesktop } from './runtime';
import { logEgress, type TransportRoute } from './egress';

export interface RelayIo {
  send: (text: string) => void;
  frames: AsyncGenerator<string>;
  close: () => void;
}

type BridgeEvent = { type: 'Frame'; data: string } | { type: 'Closed'; reason?: string };

export const openBridge = async (url: string): Promise<{ io: RelayIo; route: TransportRoute }> => {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { id, route } = await invoke<{ id: number; route: TransportRoute }>(
    'relay_stream_start',
    { url },
  );

  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;
  let closed = false;
  const unlistenP = listen<BridgeEvent>(`relay://${id}`, (e) => {
    if (e.payload.type === 'Frame') queue.push(e.payload.data);
    else closed = true;
    resolveNext?.();
  });

  async function* frameGen(): AsyncGenerator<string> {
    await unlistenP; // don't miss frames before the listener attaches
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

  const io: RelayIo = {
    send: (text) => {
      void invoke('relay_stream_send', { id, message: text }).catch(() => {/* socket gone */});
    },
    frames: frameGen(),
    close: () => {
      closed = true;
      resolveNext?.();
      void invoke('relay_stream_stop', { id }).catch(() => {/* already gone */});
      void unlistenP.then((un) => un());
    },
  };
  return { io, route };
};

export const openBrowser = (url: string): RelayIo => {
  logEgress('ws', url);
  const ws = new WebSocket(url);
  const queue: string[] = [];
  const pendingSends: string[] = []; // buffered until the socket opens
  let resolveNext: (() => void) | null = null;
  let closed = false;

  async function* frameGen(): AsyncGenerator<string> {
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
    send: (text) => {
      if (ws.readyState === WebSocket.CONNECTING) pendingSends.push(text);
      else ws.send(text);
    },
    frames: frameGen(),
    close: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
};

/** Open the right transport for this runtime. */
export const openIo = async (
  url: string,
): Promise<{ io: RelayIo; route: TransportRoute | undefined }> => {
  if (isDesktop()) return openBridge(url);
  return { io: openBrowser(url), route: undefined };
};
