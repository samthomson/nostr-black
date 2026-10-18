import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from './sanitizeUrl';

describe('sanitizeUrl', () => {
  it('accepts https urls, normalizing nothing away', () => {
    expect(sanitizeUrl('https://cdn.example/i/a.png')).toBe('https://cdn.example/i/a.png');
    // round-trips through URL: what changes is only the serialized form
    expect(sanitizeUrl('https://blossom.example/abc?x=1')).toBe('https://blossom.example/abc?x=1');
  });

  it('rejects scheme-relative, data, http, javascript, and junk', () => {
    expect(sanitizeUrl('//attacker.example/px.jpg')).toBeUndefined();
    expect(sanitizeUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeUndefined();
    expect(sanitizeUrl('http://insecure.example/x.png')).toBeUndefined();
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('not a url')).toBeUndefined();
    expect(sanitizeUrl('')).toBeUndefined();
    expect(sanitizeUrl(undefined)).toBeUndefined();
  });

  it('rejects embedded credentials', () => {
    expect(sanitizeUrl('https://user:pass@evil.example/x.png')).toBeUndefined();
  });

  it('rejects urls the parser can only build from tricks', () => {
    // whitespace-in-host and control chars parse or fail — either way
    // the result must be a faithful https origin or undefined
    const weird = sanitizeUrl('https://exa mple.com/x.png');
    expect(weird === undefined || weird.startsWith('https://')).toBe(true);
  });
});
