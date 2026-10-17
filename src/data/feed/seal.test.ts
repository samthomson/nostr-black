import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import { completeDownTo, sealPage, type RelayResponse } from './seal';

let seq = 0;
const note = (created_at: number, id = `${(seq += 1)}`.padStart(64, '0')): NostrEvent => ({
  id,
  pubkey: 'a'.repeat(64),
  created_at,
  kind: 1,
  tags: [],
  content: '',
  sig: 'c'.repeat(128),
});

const from = (url: string, events: NostrEvent[], eose = true): RelayResponse =>
  ({ url, events, eose });

describe('completeDownTo', () => {
  it('trusts a full page only down to its oldest event', () => {
    const events = [note(300), note(200), note(100)];
    expect(completeDownTo(from('wss://a/', events), 3)).toBe(100);
  });

  it('treats a short page with EOSE as exhausted', () => {
    expect(completeDownTo(from('wss://a/', [note(300)]), 3)).toBe(-Infinity);
  });

  it('treats an empty page with EOSE as exhausted', () => {
    expect(completeDownTo(from('wss://a/', []), 3)).toBe(-Infinity);
  });

  it('knows nothing about a relay that never finished', () => {
    const events = [note(300), note(200), note(100)];
    expect(completeDownTo(from('wss://a/', events, false), 3)).toBeUndefined();
  });

  it('treats an over-full page as a full one', () => {
    const events = [note(300), note(200), note(100), note(50)];
    expect(completeDownTo(from('wss://a/', events), 3)).toBe(50);
  });
});

describe('sealPage', () => {
  it('sorts across relays rather than clustering by who answered', () => {
    const page = sealPage([
      from('wss://a/', [note(500), note(300), note(100)]),
      from('wss://b/', [note(400), note(200), note(50)]),
    ], 3);

    // Per-relay rendering would give 500,300,100,400,200,50 — one author's
    // backlog as a wall. Sealing interleaves them properly. The 50 is below
    // the floor of 100 and waits for the next page.
    expect(page.floor).toBe(100);
    expect(page.events.map((e) => e.created_at)).toEqual([500, 400, 300, 200, 100]);
  });

  it('takes the newest per-relay mark as the floor', () => {
    const page = sealPage([
      from('wss://deep/', [note(500), note(400), note(300)]),
      from('wss://shallow/', [note(900), note(800), note(700)]),
    ], 3);

    // wss://deep is covered down to 300, but wss://shallow only to 700, so
    // nothing below 700 is provably complete.
    expect(page.floor).toBe(700);
    expect(page.events.map((e) => e.created_at)).toEqual([900, 800, 700]);
  });

  it('holds back events below the floor even though it has them', () => {
    const page = sealPage([
      from('wss://a/', [note(900), note(800), note(700)]),
      from('wss://b/', [note(600), note(500)]),
    ], 3);

    // b is exhausted (-Infinity), a is complete to 700, so the floor is 700.
    // b's older notes exist but belong to the next page, not this one.
    expect(page.floor).toBe(700);
    expect(page.events.map((e) => e.created_at)).toEqual([900, 800, 700]);
  });

  it('keeps everything when every relay is exhausted', () => {
    const page = sealPage([
      from('wss://a/', [note(900), note(300)]),
      from('wss://b/', [note(600)]),
    ], 10);

    expect(page.floor).toBe(-Infinity);
    expect(page.exhausted).toBe(true);
    expect(page.events.map((e) => e.created_at)).toEqual([900, 600, 300]);
  });

  it('excludes a timed-out relay from the floor but keeps its events in range', () => {
    const slow = from('wss://slow/', [note(950), note(250)], false);
    const page = sealPage([
      from('wss://a/', [note(900), note(800), note(700)]),
      slow,
    ], 3);

    expect(page.degraded).toEqual(['wss://slow/']);
    expect(page.floor).toBe(700);
    // 950 is above the floor so it shows; 250 is below and waits.
    expect(page.events.map((e) => e.created_at)).toEqual([950, 900, 800, 700]);
  });

  it('is not exhausted when some outboxes never answered', () => {
    const page = sealPage([
      from('wss://quiet/', [note(500), note(100)]),
      from('wss://late/', [], false),
    ], 10);

    expect(page.exhausted).toBe(false);
    expect(page.degraded).toEqual(['wss://late/']);
  });

  it('proves nothing when no relay answered', () => {
    const page = sealPage([
      from('wss://a/', [], false),
      from('wss://b/', [], false),
    ], 3);

    expect(page.responded).toBe(0);
    expect(page.exhausted).toBe(false);
    expect(page.events).toEqual([]);
    expect(page.degraded).toEqual(['wss://a/', 'wss://b/']);
  });

  it('is not exhausted when the only responder returned a full page', () => {
    const page = sealPage([from('wss://a/', [note(300), note(200)])], 2);

    expect(page.exhausted).toBe(false);
    expect(page.floor).toBe(200);
    expect(page.responded).toBe(1);
  });

  it('dedupes an event served by several relays', () => {
    const shared = note(500, 'f'.repeat(64));
    const page = sealPage([
      from('wss://a/', [shared, note(400)]),
      from('wss://b/', [shared, note(300)]),
    ], 10);

    expect(page.events.filter((e) => e.id === shared.id)).toHaveLength(1);
    expect(page.events).toHaveLength(3);
  });

  it('orders equal timestamps by id so the page is deterministic', () => {
    const low = note(500, '0'.repeat(64));
    const high = note(500, 'f'.repeat(64));

    expect(sealPage([from('wss://a/', [high, low])], 10).events.map((e) => e.id))
      .toEqual([low.id, high.id]);
    expect(sealPage([from('wss://a/', [low, high])], 10).events.map((e) => e.id))
      .toEqual([low.id, high.id]);
  });

  it('seals an empty page when a single relay is exhausted', () => {
    const page = sealPage([from('wss://a/', [])], 20);

    expect(page.events).toEqual([]);
    expect(page.exhausted).toBe(true);
    expect(page.responded).toBe(1);
  });

  it('never produces a page that would need reordering against the next one', () => {
    // The invariant, stated as a property: every event in a sealed page is
    // at or above the floor, and the next page starts strictly below it.
    const page = sealPage([
      from('wss://a/', [note(900), note(800), note(700)]),
      from('wss://b/', [note(850), note(650), note(600)]),
    ], 3);

    const nextUntil = page.floor - 1;
    expect(page.events.every((e) => e.created_at > nextUntil)).toBe(true);
  });
});
