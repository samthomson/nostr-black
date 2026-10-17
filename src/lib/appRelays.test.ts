import { describe, expect, it } from 'vitest';
import { normalizeRelayUrl } from './appRelays';

describe('normalizeRelayUrl', () => {
  it('normalises the canonical form: one trailing slash, lowercase host, default port dropped', () => {
    expect(normalizeRelayUrl('wss://relay.example.com')).toBe('wss://relay.example.com/');
    expect(normalizeRelayUrl('  wss://relay.example.com  ')).toBe('wss://relay.example.com/');
    expect(normalizeRelayUrl('wss://Relay.Example.COM/')).toBe('wss://relay.example.com/');
    expect(normalizeRelayUrl('wss://relay.example.com:443/')).toBe('wss://relay.example.com/');
    expect(normalizeRelayUrl('ws://localhost:8080')).toBe('ws://localhost:8080/');
  });

  it('keeps an explicit path — relays may live on one', () => {
    expect(normalizeRelayUrl('wss://relay.example.com/nostr')).toBe('wss://relay.example.com/nostr');
  });

  it('rejects double protocols, empty hosts and non-ws schemes', () => {
    expect(normalizeRelayUrl('wss://wss://relay.example.com')).toBeUndefined();
    expect(normalizeRelayUrl('ws://wss://relay.example.com')).toBeUndefined();
    expect(normalizeRelayUrl('wss:///')).toBeUndefined();
    expect(normalizeRelayUrl('wss://:8080/')).toBeUndefined();
    expect(normalizeRelayUrl('https://relay.example.com/')).toBeUndefined();
    expect(normalizeRelayUrl('relay.example.com')).toBeUndefined();
    expect(normalizeRelayUrl('')).toBeUndefined();
  });

  it('rejects queries, fragments and double-slash tails', () => {
    expect(normalizeRelayUrl('wss://relay.example.com/?token=1')).toBeUndefined();
    expect(normalizeRelayUrl('wss://relay.example.com/#top')).toBeUndefined();
    expect(normalizeRelayUrl('wss://relay.example.com//')).toBeUndefined();
  });
});
