import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  relayPlan,
  flattenPlan,
  tierRelays,
  myReadRelays,
  myWriteRelays,
  DISCOVERABLE_KINDS,
  type RoutingContext,
  type RelayEntry,
} from '@/data/routing';
import type { RelayList } from '@/lib/outbox';

const DISCOVERY = ['wss://discovery.one/', 'wss://discovery.two/'];

const ctx = (over: Partial<RoutingContext> = {}): RoutingContext => ({
  myRelays: [],
  discovery: DISCOVERY,
  authorRelays: new Map(),
  ...over,
});

const entry = (url: string, read = true, write = true): RelayEntry => ({ url, read, write });

const list = (write: string[], read: string[] = []): RelayList => ({ read, write });

const event = (kind: number): NostrEvent =>
  ({ kind, id: 'x', pubkey: 'p', created_at: 0, tags: [], content: '', sig: '' }) as NostrEvent;

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);

describe('myReadRelays / myWriteRelays', () => {
  it('falls back to discovery until the user list is synced', () => {
    expect(myReadRelays(ctx())).toEqual(DISCOVERY);
    expect(myWriteRelays(ctx())).toEqual(DISCOVERY);
  });

  it('honours read/write markers independently', () => {
    const self = ctx({
      myRelays: [
        entry('wss://both/'),
        entry('wss://readonly/', true, false),
        entry('wss://writeonly/', false, true),
      ],
    });
    expect(myReadRelays(self)).toEqual(['wss://both/', 'wss://readonly/']);
    expect(myWriteRelays(self)).toEqual(['wss://both/', 'wss://writeonly/']);
  });

  it('falls back when the synced list has no relay of the needed direction', () => {
    const self = ctx({ myRelays: [entry('wss://writeonly/', false, true)] });
    expect(myReadRelays(self)).toEqual(DISCOVERY);
    expect(myWriteRelays(self)).toEqual(['wss://writeonly/']);
  });

  it('drops non-websocket urls from the user list', () => {
    const self = ctx({
      myRelays: [entry('https://evil.example/'), entry('wss://good/')],
    });
    expect(myReadRelays(self)).toEqual(['wss://good/']);
  });
});

describe('bootstrap', () => {
  it('is discovery-only on a cold start', () => {
    const plan = relayPlan({ kind: 'bootstrap', pubkey: ALICE }, ctx());
    expect(flattenPlan(plan)).toEqual(DISCOVERY);
  });

  it('adds our own write relays once synced, without duplicating discovery', () => {
    const plan = relayPlan(
      { kind: 'bootstrap', pubkey: ALICE },
      ctx({ myRelays: [entry('wss://mine/'), entry(DISCOVERY[0])] }),
    );
    expect(flattenPlan(plan)).toEqual(['wss://mine/', DISCOVERY[0], DISCOVERY[1]]);
  });

  it('asks every relay about the user themselves', () => {
    const plan = relayPlan({ kind: 'bootstrap', pubkey: ALICE }, ctx());
    for (const subjects of plan.tiers[0].groups.values()) {
      expect(subjects).toEqual([ALICE]);
    }
  });
});

describe('manyAuthors', () => {
  const authorRelays = new Map<string, RelayList>([
    [ALICE, list(['wss://shared/', 'wss://alice/'])],
    [BOB, list(['wss://shared/'])],
  ]);

  it('asks each relay only about the authors that declared it', () => {
    const plan = relayPlan({ kind: 'manyAuthors', authors: [ALICE, BOB] }, ctx({ authorRelays }));
    const groups = plan.tiers[0].groups;
    expect([...groups.get('wss://shared/')!].sort()).toEqual([ALICE, BOB].sort());
    expect(groups.get('wss://alice/')).toEqual([ALICE]);
  });

  it('excludes authors with no relay list rather than widening to a firehose', () => {
    const plan = relayPlan(
      { kind: 'manyAuthors', authors: [ALICE, BOB, CAROL] },
      ctx({ authorRelays }),
    );
    const everySubject = [...plan.tiers[0].groups.values()].flat();
    expect(everySubject).not.toContain(CAROL);
    expect(flattenPlan(plan)).not.toContain(DISCOVERY[0]);
  });

  it('orders relays by coverage so the widest is queried first', () => {
    const plan = relayPlan({ kind: 'manyAuthors', authors: [ALICE, BOB] }, ctx({ authorRelays }));
    expect(tierRelays(plan.tiers[0])[0]).toBe('wss://shared/');
  });

  it('produces no tiers when nobody has a relay list', () => {
    const plan = relayPlan({ kind: 'manyAuthors', authors: [CAROL] }, ctx());
    expect(plan.tiers).toEqual([]);
    expect(flattenPlan(plan)).toEqual([]);
  });

  it('never connects to a hostile url smuggled through a kind 10002', () => {
    const hostile = new Map<string, RelayList>([
      [ALICE, list(['javascript:alert(1)', 'http://plaintext/', 'wss://ok/'])],
    ]);
    const plan = relayPlan({ kind: 'manyAuthors', authors: [ALICE] }, ctx({ authorRelays: hostile }));
    expect(flattenPlan(plan)).toEqual(['wss://ok/']);
  });
});

describe('oneAuthor', () => {
  const authorRelays = new Map<string, RelayList>([[ALICE, list(['wss://alice/'])]]);

  it('tries the author’s own relays before ours', () => {
    const plan = relayPlan({ kind: 'oneAuthor', pubkey: ALICE }, ctx({ authorRelays }));
    expect(tierRelays(plan.tiers[0])).toEqual(['wss://alice/']);
    expect(tierRelays(plan.tiers[1])).toEqual(DISCOVERY);
  });

  it('uses the logged-in user’s write relays for their own notes', () => {
    const plan = relayPlan(
      { kind: 'oneAuthor', pubkey: ALICE },
      ctx({ pubkey: ALICE, myRelays: [entry('wss://mine/')], authorRelays }),
    );
    expect(tierRelays(plan.tiers[0])).toEqual(['wss://alice/', 'wss://mine/']);
  });

  it('merges hints into the author tier', () => {
    const plan = relayPlan(
      { kind: 'oneAuthor', pubkey: ALICE, hints: ['wss://hint/', 'not-a-relay'] },
      ctx({ authorRelays }),
    );
    expect(tierRelays(plan.tiers[0])).toEqual(['wss://alice/', 'wss://hint/']);
  });

  it('falls back to a single tier of our relays when the author is unknown', () => {
    const plan = relayPlan({ kind: 'oneAuthor', pubkey: CAROL }, ctx({ authorRelays }));
    expect(plan.tiers).toHaveLength(1);
    expect(tierRelays(plan.tiers[0])).toEqual(DISCOVERY);
  });
});

describe('resolveById', () => {
  const authorRelays = new Map<string, RelayList>([[ALICE, list(['wss://alice/'])]]);

  it('orders hints, then ours, then the author’s', () => {
    const plan = relayPlan(
      { kind: 'resolveById', id: 'note1', author: ALICE, hints: ['wss://hint/'] },
      ctx({ myRelays: [entry('wss://mine/')], authorRelays }),
    );
    expect(plan.tiers.map(tierRelays)).toEqual([
      ['wss://hint/'],
      ['wss://mine/'],
      ['wss://alice/'],
    ]);
  });

  it('skips the hint tier when there are none, and the author tier when unknown', () => {
    const plan = relayPlan({ kind: 'resolveById', id: 'note1' }, ctx());
    expect(plan.tiers).toHaveLength(1);
    expect(tierRelays(plan.tiers[0])).toEqual(DISCOVERY);
  });

  it('asks every tier about the same event id', () => {
    const plan = relayPlan(
      { kind: 'resolveById', id: 'note1', author: ALICE, hints: ['wss://hint/'] },
      ctx({ authorRelays }),
    );
    for (const tier of plan.tiers) {
      for (const subjects of tier.groups.values()) expect(subjects).toEqual(['note1']);
    }
  });
});

describe('engagement', () => {
  const targets = [
    { id: 'note1', foundOn: ['wss://one/', 'wss://two/'] },
    { id: 'note2', foundOn: ['wss://two/'] },
  ];

  it('asks each relay only about the notes it served', () => {
    const plan = relayPlan({ kind: 'engagement', targets }, ctx());
    const groups = plan.tiers[0].groups;
    expect(groups.get('wss://one/')).toEqual(['note1']);
    expect([...groups.get('wss://two/')!].sort()).toEqual(['note1', 'note2']);
  });

  it('does not reach for discovery or our own relays', () => {
    const plan = relayPlan({ kind: 'engagement', targets }, ctx({ myRelays: [entry('wss://mine/')] }));
    expect(flattenPlan(plan)).toEqual(['wss://two/', 'wss://one/']);
  });

  it('adds the root author’s inbox only when a thread is opened', () => {
    const authorRelays = new Map<string, RelayList>([
      [ALICE, list(['wss://alicewrite/'], ['wss://aliceinbox/'])],
    ]);
    const closed = relayPlan({ kind: 'engagement', targets }, ctx({ authorRelays }));
    expect(closed.tiers).toHaveLength(1);

    const opened = relayPlan(
      { kind: 'engagement', targets, rootAuthor: ALICE },
      ctx({ authorRelays }),
    );
    expect(tierRelays(opened.tiers[1])).toEqual(['wss://aliceinbox/']);
    expect(opened.tiers[1].groups.get('wss://aliceinbox/')).toEqual(['note1', 'note2']);
  });

  it('produces no tiers for notes with no known provenance', () => {
    const plan = relayPlan({ kind: 'engagement', targets: [{ id: 'note1', foundOn: [] }] }, ctx());
    expect(plan.tiers).toEqual([]);
  });
});

describe('publish', () => {
  const self = ctx({ myRelays: [entry('wss://mine/')] });

  it('sends discoverable kinds to our write relays and discovery', () => {
    for (const kind of DISCOVERABLE_KINDS) {
      const plan = relayPlan({ kind: 'publish', event: event(kind) }, self);
      expect(flattenPlan(plan)).toEqual(['wss://mine/', ...DISCOVERY]);
    }
  });

  it('keeps everything else on our write relays only', () => {
    for (const kind of [1, 7, 1111, 10000, 30000]) {
      const plan = relayPlan({ kind: 'publish', event: event(kind) }, self);
      expect(flattenPlan(plan)).toEqual(['wss://mine/']);
    }
  });

  it('does not broadcast an encrypted list to discovery', () => {
    // kind 10000 (mute list) carries encrypted content; the ciphertext is
    // safe but the publish timing is not.
    const plan = relayPlan({ kind: 'publish', event: event(10000) }, self);
    expect(flattenPlan(plan)).not.toContain(DISCOVERY[0]);
  });

  it('carries no per-relay narrowing', () => {
    const plan = relayPlan({ kind: 'publish', event: event(1) }, self);
    expect([...plan.tiers[0].groups.values()]).toEqual([[]]);
  });
});

describe('flattenPlan', () => {
  it('dedupes across tiers while preserving tier order', () => {
    const authorRelays = new Map<string, RelayList>([[ALICE, list(['wss://shared/'])]]);
    const plan = relayPlan(
      { kind: 'resolveById', id: 'note1', author: ALICE, hints: ['wss://shared/'] },
      ctx({ myRelays: [entry('wss://mine/')], authorRelays }),
    );
    expect(flattenPlan(plan)).toEqual(['wss://shared/', 'wss://mine/']);
  });
});
