import { describe, expect, it } from 'vitest';
import {
  EDITABLE_PROFILE_FIELDS,
  editedProfileContent,
} from './profileMetadata';

const CURRENT = JSON.stringify({
  display_name: 'Sam',
  name: 'sam',
  about: 'building',
  picture: 'https://example.com/me.jpg',
  lud16: 'sam@example.com',
  bot: false,
  xmpp: 'sam@jabber.example',
});

describe('editedProfileContent', () => {
  it('overlays edits and preserves every unknown field byte-for-byte', () => {
    const result = editedProfileContent(CURRENT, { about: 'new text' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual(['about']);
    const next = JSON.parse(result.content);
    expect(next.about).toBe('new text');
    expect(next.lud16).toBe('sam@example.com');
    expect(next.bot).toBe(false);
    expect(next.xmpp).toBe('sam@jabber.example');
    expect(next.display_name).toBe('Sam');
  });

  it('clearing a field removes only that key', () => {
    const result = editedProfileContent(CURRENT, { about: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = JSON.parse(result.content);
    expect('about' in next).toBe(false);
    expect(next.lud16).toBe('sam@example.com');
    expect(next.picture).toBe('https://example.com/me.jpg');
  });

  it('reports nothing changed when values match (whitespace-trimmed)', () => {
    const result = editedProfileContent(CURRENT, { about: ' building ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual([]);
    expect(JSON.parse(result.content).about).toBe('building');
  });

  it('a fresh identity starts from empty content additively', () => {
    const result = editedProfileContent('', { display_name: 'New', name: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toEqual(['display_name']);
    expect(JSON.parse(result.content)).toEqual({ display_name: 'New' });
  });

  it('malformed current content is a hard stop, never a rewrite', () => {
    const result = editedProfileContent('not json at all', { about: 'x' });
    expect(result).toEqual({ ok: false, error: 'unparseable' });
  });

  it('non-object content (array, string, number) is equally refused', () => {
    expect(editedProfileContent('[1,2]', { about: 'x' })).toEqual({ ok: false, error: 'unparseable' });
    expect(editedProfileContent('"hello"', { about: 'x' })).toEqual({ ok: false, error: 'unparseable' });
  });

  it('the editable set never includes zap or bot fields', () => {
    expect(EDITABLE_PROFILE_FIELDS).not.toContain('lud06');
    expect(EDITABLE_PROFILE_FIELDS).not.toContain('lud16');
    expect(EDITABLE_PROFILE_FIELDS).not.toContain('bot');
  });
});
