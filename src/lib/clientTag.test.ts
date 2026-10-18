import { describe, expect, it } from 'vitest';
import { BLACK_CLIENT_TAG, COMMON_CLIENTS, clientTagOf } from './clientTag';
import type { ClientTagConfig } from '@/contexts/AppContext';

const policy = (overrides: Partial<ClientTagConfig>): ClientTagConfig => ({
  mode: 'none',
  spoof: [],
  ...overrides,
});

describe('clientTagOf', () => {
  it('sends no tag by default', () => {
    expect(clientTagOf(policy({ mode: 'none' }))).toBeUndefined();
    expect(clientTagOf(policy({ mode: 'none' }), 'ff'.repeat(32))).toBeUndefined();
  });

  it('claims nostr.black in black mode', () => {
    expect(clientTagOf(policy({ mode: 'black' }))).toBe(BLACK_CLIENT_TAG);
    expect(BLACK_CLIENT_TAG).toBe('nostr.black');
  });

  it('spoof sends nothing on an empty pool, not a fake name', () => {
    expect(clientTagOf(policy({ mode: 'spoof', spoof: [] }), 'aa'.repeat(32))).toBeUndefined();
  });

  it('spoof picks from the pool, deterministically per seed', () => {
    const pool = ['Damus', 'Primal', 'Amethyst'];
    const p = policy({ mode: 'spoof', spoof: pool });
    const a = clientTagOf(p, 'hello world');
    const b = clientTagOf(p, 'different note');
    expect(pool).toContain(a);
    expect(pool).toContain(b);
    // stable: the same seed always claims the same client
    expect(clientTagOf(p, 'hello world')).toBe(a);
    expect(clientTagOf(p, 'different note')).toBe(b);
  });

  it('a big pool rotates — different seeds land on different clients', () => {
    const p = policy({ mode: 'spoof', spoof: [...COMMON_CLIENTS] });
    const picks = new Set(Array.from({ length: 64 }, (_, i) =>
      clientTagOf(p, `note number ${i}`)));
    expect(picks.size).toBeGreaterThan(2);
  });

  it('without a seed spoof picks the first pool entry', () => {
    expect(clientTagOf(policy({ mode: 'spoof', spoof: ['Damus', 'Iris'] }))).toBe('Damus');
  });

  it('an empty seed behaves like no seed', () => {
    expect(clientTagOf(policy({ mode: 'spoof', spoof: ['Damus', 'Iris'] }), '')).toBe('Damus');
  });
});
