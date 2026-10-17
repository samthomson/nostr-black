import { describe, expect, it } from 'vitest';
import { diffLines, diffText, type DiffSegment } from './diff';

/** The original text, reconstructed from everything but additions. */
const original = (segs: readonly DiffSegment[]): string =>
  segs.filter((s) => s.op !== 'add').map((s) => s.text).join('');

/** The revised text, reconstructed from everything but deletions. */
const revised = (segs: readonly DiffSegment[]): string =>
  segs.filter((s) => s.op !== 'del').map((s) => s.text).join('');

describe('diffText', () => {
  it('leaves identical text as one unchanged segment', () => {
    expect(diffText('same', 'same')).toEqual([{ op: 'same', text: 'same' }]);
  });

  it('turns an empty original into all additions', () => {
    expect(diffText('', 'new')).toEqual([{ op: 'add', text: 'new' }]);
  });

  it('turns an empty revision into all deletions', () => {
    expect(diffText('old', '')).toEqual([{ op: 'del', text: 'old' }]);
  });

  it('reconstructs both sides from a word replacement', () => {
    const segs = diffText('the cat sat', 'the dog sat');
    expect(original(segs)).toBe('the cat sat');
    expect(revised(segs)).toBe('the dog sat');
    expect(segs.some((s) => s.op === 'del' && s.text === 'cat')).toBe(true);
    expect(segs.some((s) => s.op === 'add' && s.text === 'dog')).toBe(true);
  });

  it('marks a single character change, not the whole word', () => {
    const segs = diffText('hello world', 'hellp world');
    expect(original(segs)).toBe('hello world');
    expect(revised(segs)).toBe('hellp world');
    expect(segs.some((s) => s.op === 'del' && s.text === 'o')).toBe(true);
    expect(segs.some((s) => s.op === 'add' && s.text === 'p')).toBe(true);
    expect(segs.some((s) => s.op === 'del' && s.text === 'hello')).toBe(false);
  });

  it('preserves whitespace and line breaks through an edit', () => {
    const segs = diffText('line one\nline two', 'line one\nline two, edited');
    expect(original(segs)).toBe('line one\nline two');
    expect(revised(segs)).toBe('line one\nline two, edited');
  });
});

describe('diffLines', () => {
  it('returns one change row for a single-line edit', () => {
    const rows = diffLines('hello', 'hallo');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('change');
    expect(rows[0].left).toBe('hello');
    expect(rows[0].right).toBe('hallo');
  });

  it('keeps context lines and marks only the changed line', () => {
    const rows = diffLines('line one\nline two\nline three', 'line one\nline TWO\nline three');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'change', 'same']);
    expect(rows[1].left).toBe('line two');
    expect(rows[1].right).toBe('line TWO');
  });

  it('splits a pure insertion into an add row', () => {
    const rows = diffLines('a\nb', 'a\nb\nc');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'add']);
    expect(rows[2].right).toBe('c');
  });

  it('splits a pure deletion into a del row', () => {
    const rows = diffLines('a\nb\nc', 'a\nc');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'del', 'same']);
    expect(rows[1].left).toBe('b');
  });
});
