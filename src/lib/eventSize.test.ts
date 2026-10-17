import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { MAX_EVENT_BYTES, eventBytes, eventTooLarge } from './eventSize';

const event = (content: string): NostrEvent => ({
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1,
  kind: 1,
  tags: [],
  content,
  sig: 'c'.repeat(128),
});

describe('eventSize', () => {
  it('measures the serialized size of an event', () => {
    expect(eventBytes(event('hello'))).toBe(JSON.stringify(event('hello')).length);
  });

  it('flags only events past the relay cap', () => {
    expect(eventTooLarge(event('hello'))).toBe(false);
    expect(eventTooLarge(event('x'.repeat(MAX_EVENT_BYTES)))).toBe(true);
  });
});
