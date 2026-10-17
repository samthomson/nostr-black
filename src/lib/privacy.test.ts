import { describe, it, expect } from 'vitest';
import { PRIVACY, PRIVACY_ORDER, nextLessPrivate, nextMorePrivate, PRIVACY_BUTTON } from './privacy';

describe('privacy grades', () => {
  it('orders private → public with one entry per grade', () => {
    expect(PRIVACY_ORDER).toEqual(['private', 'high', 'medium', 'low', 'public']);
    for (const grade of PRIVACY_ORDER) {
      expect(PRIVACY[grade].bg).toBe(`var(--privacy-${grade === 'public' ? 'public' : grade})`);
    }
  });

  it('darker grades take light text, lighter grades take dark text', () => {
    // black through mid-grey: inverted (light) text
    for (const grade of ['private', 'high', 'medium'] as const) {
      expect(PRIVACY[grade].fg).toBe('var(--privacy-public)');
      expect(PRIVACY[grade].className).toContain('text-privacy-public');
      expect(PRIVACY[grade].className).toContain('hover:text-privacy-public');
    }
    // light grey through white: dark text
    for (const grade of ['low', 'public'] as const) {
      expect(PRIVACY[grade].fg).toBe('var(--privacy-private)');
      expect(PRIVACY[grade].className).toContain('text-privacy-private');
      expect(PRIVACY[grade].className).toContain('hover:text-privacy-private');
    }
  });

  it('hover stays on the privacy scale (never washes to primary white)', () => {
    for (const grade of PRIVACY_ORDER) {
      expect(PRIVACY[grade].className).toMatch(/hover:bg-privacy-/);
      expect(PRIVACY[grade].className).not.toMatch(/hover:bg-primary/);
    }
  });

  it('labels are lowercase and human', () => {
    expect(PRIVACY.private.label).toBe('private');
    expect(PRIVACY.public.label).toBe('public');
    expect(PRIVACY.high.label).toBe('high privacy');
  });

  it('neighbour navigation clamps at the extremes', () => {
    expect(nextMorePrivate('private')).toBe('private');
    expect(nextLessPrivate('public')).toBe('public');
    expect(nextLessPrivate('private')).toBe('high');
    expect(nextMorePrivate('public')).toBe('low');
  });

  it('privacy buttons share one size chrome', () => {
    expect(PRIVACY_BUTTON).toMatch(/h-8/);
    expect(PRIVACY_BUTTON).toMatch(/px-3/);
    expect(PRIVACY_BUTTON).toMatch(/rounded-sm/);
  });
});
