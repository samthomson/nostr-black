import { describe, it, expect, vi, beforeEach } from 'vitest';

// Browser path under test — force web runtime; signature verification stubbed.
vi.mock('@/net/runtime', () => ({ isDesktop: () => false }));
vi.mock('nostr-tools', () => ({ verifyEvent: () => true }));

import { queryRelay, egressLog, setAuthSigner, type EgressEntry } from './net';

type Frame = [string, string, unknown?] ;

/** Minimal scripted WebSocket double: opens, then plays frames. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  // test driver
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  frame(f: Frame) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  finish() {
    this.onclose?.();
  }
}

/** The sub id this client actually used (module state persists across tests). */
const subIdOf = (ws: FakeWebSocket): string => {
  const req = ws.sent.find((m) => m.startsWith('["REQ"'));
  return JSON.parse(req!)[1] as string;
};

const event = (id: string, pubkey = 'a'.repeat(64)): { id: string; pubkey: string; kind: number; created_at: number; tags: unknown[]; content: string; sig: string } => ({
  id,
  pubkey,
  kind: 1,
  created_at: 1700000000,
  tags: [],
  content: 'hello',
  sig: 'x',
});

describe('queryRelay (browser transport)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    egressLog.length = 0;
    vi.restoreAllMocks();
  });

  it('answers NIP-42 AUTH challenges and re-requests', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    setAuthSigner(async (challenge) => ({
      id: '2'.repeat(64),
      pubkey: 'a'.repeat(64),
      kind: 22242,
      created_at: 1700000000,
      tags: [['challenge', challenge]],
      content: '',
      sig: 'ok',
    }));

    const promise = queryRelay('wss://auth.example/', [{ kinds: [1] }]);
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    // Relay challenges immediately after the REQ.
    ws.frame(['AUTH', 'challenge-abc']);
    // After our AUTH answer + re-REQ, it serves.
    await new Promise((r) => setTimeout(r, 10));
    const sentAuth = ws.sent.find((m) => m.startsWith('["AUTH"'));
    expect(sentAuth).toContain('challenge-abc');
    expect(ws.sent.filter((m) => m.startsWith('["REQ"')).length).toBe(2); // re-REQ happened
    ws.frame(['EVENT', subIdOf(ws), event('3'.repeat(64))]);
    ws.frame(['EOSE', subIdOf(ws)]);
    const events = await promise;
    expect(events.map((e) => e.id)).toEqual(['3'.repeat(64)]);
    setAuthSigner(undefined);
    vi.unstubAllGlobals();
  });

  it('marks auth-required relays when not signed in', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    setAuthSigner(undefined);

    const promise = queryRelay('wss://auth2.example/', [{ kinds: [1] }]);
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.frame(['AUTH', 'challenge-xyz']);
    const events = await promise;
    expect(events).toEqual([]);
    const entry = egressLog.find((e) => e.kind === 'query') as EgressEntry;
    expect(entry.status).toBe('auth');
    expect(entry.reason).toContain('not logged in');
    vi.unstubAllGlobals();
  });

  it('collects EVENT frames until EOSE', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

    const promise = queryRelay('wss://relay.example/', [{ kinds: [1] }]);
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.frame(['EVENT', subIdOf(ws), event('1'.repeat(64))]);
    ws.frame(['EOSE', subIdOf(ws)]);
    const events = await promise;

    expect(events.map((e) => e.id)).toEqual(['1'.repeat(64)]);
    const entry = egressLog.find((e) => e.kind === 'query') as EgressEntry;
    expect(entry.status).toBe('ok');
    expect(entry.events).toBe(1);
    vi.unstubAllGlobals();
  });
});
