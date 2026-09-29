import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Browser path under test — force web runtime; signature verification stubbed.
vi.mock('@/net/runtime', () => ({ isDesktop: () => false }));
vi.mock('nostr-tools', () => ({ verifyEvent: () => true }));

import {
  queryRelay,
  egressLog,
  setAuthSigner,
  closeAllConnections,
  type EgressEntry,
} from './net';

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

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Leasing a warm connection is async, so the socket appears a tick after
 * the query starts rather than synchronously inside it.
 */
const socketAt = async (index = 0): Promise<FakeWebSocket> => {
  for (let i = 0; i < 20 && FakeWebSocket.instances.length <= index; i++) await tick();
  return FakeWebSocket.instances[index]!;
};

describe('queryRelay (browser transport)', () => {
  beforeEach(() => {
    closeAllConnections();
    FakeWebSocket.instances = [];
    egressLog.length = 0;
    vi.restoreAllMocks();
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    closeAllConnections();
    setAuthSigner(undefined);
    vi.unstubAllGlobals();
  });

  it('answers NIP-42 AUTH challenges and re-requests', async () => {
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
    const ws = await socketAt();
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
  });

  it('marks auth-required relays when not signed in', async () => {
    setAuthSigner(undefined);

    const promise = queryRelay('wss://auth2.example/', [{ kinds: [1] }]);
    const ws = await socketAt();
    ws.open();
    ws.frame(['AUTH', 'challenge-xyz']);
    const events = await promise;
    expect(events).toEqual([]);
    const entry = egressLog.find((e) => e.kind === 'query') as EgressEntry;
    expect(entry.status).toBe('auth');
    expect(entry.reason).toContain('not logged in');
  });

  it('surfaces NOTICE auth refusals instead of silent empties', async () => {
    setAuthSigner(undefined);

    const promise = queryRelay('wss://notice.example/', [{ kinds: [1] }]);
    const ws = await socketAt();
    ws.open();
    ws.frame(['NOTICE', 'auth-required: please authenticate']);
    ws.frame(['EOSE', subIdOf(ws)]);
    const events = await promise;
    expect(events).toEqual([]);
    const entry = egressLog.find((e) => e.kind === 'query') as EgressEntry;
    expect(entry.status).toBe('auth');
    expect(entry.reason).toContain('auth-required');
  });

  it('collects EVENT frames until EOSE', async () => {
    const promise = queryRelay('wss://relay.example/', [{ kinds: [1] }]);
    const ws = await socketAt();
    ws.open();
    ws.frame(['EVENT', subIdOf(ws), event('1'.repeat(64))]);
    ws.frame(['EOSE', subIdOf(ws)]);
    const events = await promise;

    expect(events.map((e) => e.id)).toEqual(['1'.repeat(64)]);
    const entry = egressLog.find((e) => e.kind === 'query') as EgressEntry;
    expect(entry.status).toBe('ok');
    expect(entry.events).toBe(1);
  });

  it('multiplexes concurrent queries over a single socket', async () => {
    const first = queryRelay('wss://shared.example/', [{ kinds: [1] }]);
    const ws = await socketAt();
    ws.open();
    const second = queryRelay('wss://shared.example/', [{ kinds: [7] }]);
    await tick();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const [subA, subB] = ws.sent
      .filter((m) => m.startsWith('["REQ"'))
      .map((m) => JSON.parse(m)[1] as string);
    expect(subA).not.toBe(subB);

    ws.frame(['EVENT', subA, event('1'.repeat(64))]);
    ws.frame(['EVENT', subB, event('2'.repeat(64))]);
    ws.frame(['EOSE', subA]);
    ws.frame(['EOSE', subB]);

    expect((await first).map((e) => e.id)).toEqual(['1'.repeat(64)]);
    expect((await second).map((e) => e.id)).toEqual(['2'.repeat(64)]);
  });

  it('closes the subscription but leaves the socket warm for the next query', async () => {
    const promise = queryRelay('wss://warm.example/', [{ kinds: [1] }]);
    const ws = await socketAt();
    ws.open();
    const subId = subIdOf(ws);
    ws.frame(['EOSE', subId]);
    await promise;

    expect(ws.sent).toContain(JSON.stringify(['CLOSE', subId]));
    expect(ws.readyState).not.toBe(FakeWebSocket.CLOSED);

    await queryRelay('wss://warm.example/', [{ kinds: [1] }], { timeoutMs: 1 });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
