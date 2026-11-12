import { describe, it, expect } from 'vitest';
import { canonicalJson, jsonTokens } from './json';

const kinds = (source: string): string[] => jsonTokens(source).map((t) => t.kind);
const text = (source: string): string => jsonTokens(source).map((t) => t.text).join('');

describe('jsonTokens', () => {
  it('keys vs string values: a quoted token followed by a colon is a key', () => {
    expect(kinds('{"id": "abc"}')).toEqual(['punct', 'key', 'string', 'punct']);
  });

  it('numbers and keywords tokenize distinctly', () => {
    expect(kinds('{"n": -1.5e3, "ok": true, "x": null}')).toEqual([
      'punct', 'key', 'number', 'punct', 'key', 'keyword', 'punct', 'key', 'keyword', 'punct',
    ]);
  });

  it('reconstructs the source exactly — lossless tokenization', () => {
    const source = JSON.stringify({ a: [1, 'two", tricky', null, true], b: { c: 'd' } }, null, 4);
    expect(text(source)).toBe(source);
  });

  it('escaped quotes inside strings stay one token', () => {
    const tokens = jsonTokens('{"say": "he said \\"hi\\""}');
    expect(tokens.filter((t) => t.kind === 'string')).toHaveLength(1);
    expect(text('{"say": "he said \\"hi\\""}')).toBe('{"say": "he said \\"hi\\""}');
  });

  it('canonicalJson reads a nostr event in NIP-01 order regardless of input order', () => {
    const scrambled = { sig: 's', tags: [['p', 'x']], content: 'c', created_at: 1, kind: 1, pubkey: 'k', id: 'i', extra: 'e' };
    const out = canonicalJson(scrambled);
    expect(out.indexOf('"id"')).toBeLessThan(out.indexOf('"kind"'));
    expect(out.indexOf('"kind"')).toBeLessThan(out.indexOf('"pubkey"'));
    expect(out.indexOf('"pubkey"')).toBeLessThan(out.indexOf('"content"'));
    expect(out.indexOf('"content"')).toBeLessThan(out.indexOf('"tags"'));
    expect(out.indexOf('"tags"')).toBeLessThan(out.indexOf('"created_at"'));
    // sig is always dead last; extras keep their original order after it
    expect(out.indexOf('"created_at"')).toBeLessThan(out.indexOf('"sig"'));
    expect(out.indexOf('"extra"')).toBeGreaterThan(out.indexOf('"sig"'));
    expect(text(out)).toBe(out);
  });
});
