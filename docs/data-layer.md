# Data layer design

Status: phases 1–7 (routing, transport, store, feed, persist, resolver, thread) done. Plan of record for the app is
`README.md`; this document covers only how data is fetched, cached, ordered and resolved.

## Why

The app works but its data path has three structural faults. None are fixable by patching the
current hooks.

**One socket per query.** `queryRelay` (`src/net/net.ts`) opens a WebSocket, sends one REQ, waits
for EOSE, closes. Over Tor every query is a fresh circuit. `useOutboxFeed` does this across dozens
of relays in waves of 8, and `Note` adds more per visible note. Connection setup, not bandwidth, is
the dominant cost.

**The cache is request-keyed, not entity-keyed.** TanStack Query caches *requests*. We need to cache
*facts*. The same kind 0 for one pubkey is currently stored three times under unrelated keys with
three different relay strategies:

| key | relays | limit |
|---|---|---|
| `['author', pubkey]` | my read relays | 3 |
| `['profile', 'metadata', pubkey, writeRelays]` | author's write relays, read fallback | 1 |
| `['nostr', 'logins', loginIds]` | my read relays, batched | none |

Kind 10002 is split four ways (`['profile','relays',…]`, the `['outbox','relaylists',…]` batch, an
uncached inline lookup in `useEventById`, and `UserState.relayMetadata` in localStorage). Events by
id have two namespaces (`['event',…]` and `['event-by-id',…]`). `['profile','notes',pubkey,relays]`
omits `kinds` and `limit` from its key, so it will serve wrong data as soon as a second caller
exists. These are all the same bug.

**No event store.** `gcTime: Infinity` in memory only; localStorage holds parsed follows and relay
lists; IndexedDB holds media bytes. Nothing persists events, so every cold start refetches
everything over Tor.

## Shape

```
┌─ UI ──────────── useSyncExternalStore bindings. declares wants, never fetches
├─ Resolver ────── store + wants + dependency extraction + feed engine
├─ Scheduler ───── coalescing, priority lanes, concurrency caps, in-flight dedup, poll rotation
└─ Transport ───── warm multiplexed relay connections (src/net)
```

Rules that fall out of this and are not negotiable inside the refactor:

- no component calls the network, directly or through a fetching hook
- every read of Nostr data resolves against the store
- every network request originates from the scheduler
- relay selection happens in exactly one module

## Module layout

```
src/data/
    routing.ts          relay selection policy (pure)
    wants.ts            Want types, want keys, staleness policy (pure)
    extract.ts          event -> dependency wants (pure)
    engagement.ts       reply/reaction/zap tallies from the ref index (pure)
    scheduler.ts        coalescing, lanes, concurrency, dispatch
    resolver.ts         wires store + scheduler + extract; provider value
    store/
        types.ts        entity keys, stored shapes
        store.ts        normalized entity store, subscribable
        persist.ts      IndexedDB write-behind + hydration
    feed/
        spec.ts         FeedSpec
        seal.ts         watermark + page sealing (pure)
        engine.ts       pages, cursor, polling, pending buffer
    hooks/
        useEvent.ts
        useProfileMeta.ts
        useRelayList.ts
        useFeed.ts
        useVisibility.ts
```

`src/net` keeps its role as the only egress boundary. `src/lib/outbox.ts` keeps `parseFollows`,
`parseRelayList`, `buildAuthorRelayMap` and `buildRelayGroups`, which move under `routing.ts`'s
umbrella. `mergeFeed` is deleted — sealed pages replace it.

## Routing

One pure module, one function per intent. This is where the four categories live.

```ts
export type Intent =
    | { kind: 'bootstrap' }
    | { kind: 'manyAuthors'; authors: string[] }
    | { kind: 'oneAuthor'; pubkey: string }
    | { kind: 'resolveById'; author?: string; hints: string[] }
    | { kind: 'engagement'; targets: { id: string; author: string }[] }
    | { kind: 'publish'; event: NostrEvent };

export interface RelayPlan {
    /** relay url -> the authors (or ids) that relay is being asked for */
    groups: Map<string, string[]>;
}
```

| intent | relays |
|---|---|
| `bootstrap` | discovery relays only. my kind 0, 3, 10002 — nothing else is known yet |
| `manyAuthors` | outbox union of authors' write relays, grouped so each relay is asked only for the authors it serves |
| `oneAuthor` | that author's write relays, plus any relay hints |
| `resolveById` | hints, then my read relays, then the author's write relays. first tier with a hit wins. ours come before the author's because they are few, already warm, and need no kind 10002 lookup to discover |
| `engagement` | the relays the targets were *found on*, grouped so each is asked only about the notes it served. an opened thread adds the root author's read relays. see below |
| `publish` | my write relays. if the event is identity/replaceable (0, 3, 10002, 10063, NIP-51 lists) also the discovery relays |

`buildRelayGroups` already implements `manyAuthors` correctly and survives intact. Authors with no
NIP-65 list are not queried — we never fall back to a firehose.

Routing is pure and table-tested. No hook, no context, no network.

## Transport

Replace per-query sockets with warm, ref-counted, multiplexed connections.

```ts
interface RelayConnection {
    req(filters: NostrFilter[], opts: ReqOpts): Promise<ReqResult>;
    publish(event: NostrEvent): Promise<PublishResult>;
    readonly url: string;
    readonly route: TransportRoute | undefined;
}

interface ReqResult {
    events: NostrEvent[];
    /** true when the relay sent EOSE; false when we stopped on deadline */
    eose: boolean;
}

/** warm, shared, idle-closed. never one per query. */
const getConnection: (url: string) => Promise<RelayConnection>;
```

Many concurrent REQs share one socket, distinguished by subId. Idle connections close after a
timeout; a failing relay is marked degraded and backed off rather than retried tightly.

The pattern already exists in this repo — `src/net/nip46.ts` keeps long-lived adapters with a
`frameHub` fan-out over both transports (Tauri bridge on desktop, WebSocket on web). That code
generalizes; `relay_stream_start` / `relay_stream_send` / `relay_stream_stop` on the Rust side need
no changes.

NIP-42 AUTH moves from the query to the connection: one challenge answered per socket, with every
active subscription told to re-send, instead of each query authenticating separately.

That creates a privacy obligation warm connections did not have before. **A socket that answered a
challenge is bound to the identity that signed it.** Reusing one after an account switch would let
the relay link the two accounts, so every signer change drops the authenticated connections.
Sockets that never authenticated carry no identity and stay warm.

The egress log, per-event route stamping and the Tor/direct decision all stay where they are.

`queryRelay` and `queryRelays` keep their signatures through phase 2 so nothing above them breaks,
then are deleted in phase 6 once no caller remains.

## Store

Entity-keyed and normalized. This is what removes the duplication; it is not an optimization.

```ts
export type EntityKey = string;
// "e:<id>"                      immutable events
// "r:<kind>:<pubkey>"           replaceable (0, 3, 10002, 10063, 1xxxx)
// "a:<kind>:<pubkey>:<d>"       addressable (3xxxx)

export interface EntityState {
    readonly event?: NostrEvent;
    /** ms epoch of the last completed fetch for this entity */
    readonly settledAt?: number;
    /** relays this event came back from — the engagement relay set */
    readonly foundOn?: readonly string[];
}

export interface EventStore {
    /** stable reference until the entity actually changes */
    get(key: EntityKey): EntityState;
    getEvent(id: string): NostrEvent | undefined;
    getReplaceable(kind: number, pubkey: string): NostrEvent | undefined;
    getAddressable(kind: number, pubkey: string, d: string): NostrEvent | undefined;
    /** newest-first, for feed reads */
    queryByAuthors(authors: string[], kinds: number[], range?: TimeRange): NostrEvent[];
    /** events that e-tag the given id — replies, reactions, reposts, zaps */
    getRefs(targetId: string): ReadonlySet<string>;

    ingest(events: NostrEvent[], from: string): void;
    settle(keys: Iterable<EntityKey>, at?: number): void;
    subscribe(key: EntityKey, onChange: () => void): () => void;
    clear(): void;
}
```

Three properties matter and all need tests:

**Stable identity.** `get` must return the same object reference until the entity genuinely
changes, or `useSyncExternalStore` will loop. Unknown keys all share one frozen empty object.

**Settled is not the same as empty.** A spinner has to stop even when the answer is "nobody has
this". `settledAt` records that a fetch finished, hit or miss, and it is written *after* ingest so
no component ever sees "asked, and missing" in the tick the answer arrived.

**Replaceable conflict rule.** Higher `created_at` wins; on a tie the lexicographically lower id
wins (NIP-01). Applied on ingest, regardless of which relay delivered it.

Provenance (`foundOn`, `route`) moves into the store as per-event metadata rather than the parallel
`Record<string, string[]>` maps the feed threads through props today.

### Persistence

IndexedDB database `nostr-black-data`, alongside the existing `nostr-black-media`.

| store | key | index |
|---|---|---|
| `events` | entity key (`e:<id>`) | `seq` |
| `replaceable` | entity key (`r:<kind>:<pubkey>`) | `seq` |
| `addressable` | entity key (`a:<kind>:<pubkey>:<d>`) | `seq` |
| `meta` | name | next `seq` |

`seq` is a local insertion counter — the only cleartext column. There is no index on `pubkey` or
`created_at`. An index is plaintext by definition, and an index over authors and timestamps *is*
the social graph. Once the codec encrypts the body, that would be the only readable part of the
file and would describe who you follow and when you read.

Write-behind: flush on a short timer or an event-count threshold, never on the ingest path.

Hydration on boot loads all replaceable and addressable records (profiles and relay lists — small,
and the highest value per byte for cold start) plus the most recently written regular events.
Restore uses the replaceable conflict rule, so a live fetch that already won is not overwritten.
The feed seeds its first page from the store and polls for anything newer.

**Encryption seam.** README plans an encrypted local cache. `encode`/`decode` sit on the record
boundary from the first commit — identity functions today, both already async because WebCrypto
is. Retrofitting this later means touching every store. The on-disk cache is the social graph in
plaintext until that codec is real; it never leaves the device, but a shared machine can read it.

## Ordering

The hard problem, and the reason the feed currently cannot paginate.

The rule: **render sealed pages, never a live-sorted list.** A page, once shown, is never
re-sorted. Nothing is ever inserted into the middle of what the reader is looking at.

### Sealing a page

A page fetch fans out to the relay plan with `until = cursor, limit = N` and waits for whichever
comes first:

- every relay in the plan has sent EOSE
- the deadline expires (short on clearnet, generous on Tor)

Then the returned events are sorted together across all relays, the completeness watermark is
computed, and the page is sealed and appended.

Sorting across all relays before showing anything is what prevents the "wall of one author's
backlog" clustering that per-relay progressive rendering produces.

### The completeness watermark

Per relay, given a response to `{until, limit: N}`:

| response | complete down to |
|---|---|
| exactly `N` events | `oldest(events).created_at` — more may exist below |
| fewer than `N`, EOSE received | `-Infinity` — relay exhausted for this range |
| no EOSE, deadline hit | unknown — excluded from the calculation |

```
floor = max over responding relays of completeDownTo(relay)
```

The *newest* of the per-relay floors, because coverage is only solid where every relay has been
heard from. Everything at or above `floor` is complete; below it is not. The next page starts at
`until = floor - 1`, which keeps pagination correct even when the relay set changes between pages.

Relays that miss the deadline are a coverage gap that waiting does not fix. They are excluded from
the floor, recorded as degraded, and retried in the background. Their late events still land in the
store; they just do not retroactively rewrite a sealed page. This is a deliberate trade: a small
amount of "that note didn't appear in the page it belonged to" in exchange for a feed that never
moves under the reader.

`seal.ts` is pure — `(perRelayResult[], until, limit) -> { events, floor, degraded }` — and gets the
heaviest test coverage in the refactor. Boundary cases: exactly-`limit` responses, all relays
exhausted, all relays timed out, a single relay responding, duplicate events across relays.

### Forward pagination

No long-lived subscriptions. Because connections are warm and REQs are multiplexed, polling is
cheap: a background tick issues one `{authors, kinds, since: ceiling}` per relay group — frequent on
clearnet, slow on Tor.

Results ingest into the store. Anything newer than `ceiling` goes into a pending buffer, which drives
a `show N new notes` control. Nothing enters the DOM until the user clicks it.

On insert: capture `scrollHeight` before, then `scrollTop += (newHeight - oldHeight)` after. The
viewport stays fixed on the note being read and new material stacks above, so the user scrolls up
to reach it.

If the app has been backgrounded long enough that `since` would return more than a page, discard the
delta and re-seal from the top instead of trying to stitch.

```ts
interface FeedPage {
    events: NostrEvent[];     // sorted desc, sealed, never reordered
    floor: number;            // completeness watermark
    sealedAt: number;
    /** metadata for every event in the page has settled, or timed out */
    hydrated: boolean;
}

interface FeedState {
    pages: FeedPage[];        // sealed, immutable, newest page first
    pending: NostrEvent[];    // newer than ceiling, buffered, not rendered
    ceiling: number;          // newest created_at currently rendered
    cursor: number;           // next `until`
    loading: boolean;
    exhausted: boolean;
}
```

Paging forward is gated on hydration — see the hydration barrier below.

### FeedSpec

The engine is parameterized over a spec, not hardcoded to follows, so the private-feed NIP lands as
a new spec rather than a second pipeline.

```ts
interface FeedSpec {
    id: string;
    kinds: number[];
    authors: () => string[];
    routing: 'outbox' | 'explicit';
    relays?: string[];
    /** private feeds: unwrap before ingest */
    decrypt?: (event: NostrEvent) => Promise<NostrEvent>;
}
```

Cheap to define now, expensive to introduce later.

## Wants and the scheduler

The UI never requests; it declares a want. Wants are the dedupe boundary — before the network, not
in a cache key.

```ts
export type Want =
    | { type: 'profile'; pubkey: string }
    | { type: 'relayList'; pubkey: string }
    | { type: 'event'; id: string; author?: string; hints?: string[] }
    | { type: 'addressable'; kind: number; pubkey: string; d: string }
    | { type: 'engagement'; targets: string[] }   // counts for a batch of notes
    | { type: 'thread'; parent: string }          // direct children of one note
    | { type: 'feedPage'; spec: string; until: number };

export type Lane = 'interactive' | 'prefetch' | 'background';

export interface Scheduler {
    want(w: Want, lane: Lane): void;
    promote(w: Want, lane: Lane): void;
    drop(w: Want): void;
}
```

Each want has a stable key. The scheduler holds `Map<wantKey, 'pending' | 'inflight' | number>`
(the number being `satisfiedAt`). A want that is in flight, or satisfied within its staleness
window, never re-queues.

| want | stale after |
|---|---|
| `profile` | 15 min |
| `relayList` | 1 h |
| `event` | never (immutable) |
| `addressable` | 15 min |
| `engagement` | 5 min |
| `thread` | 2 min while open |

**Coalescing.** Pending wants accumulate for a short debounce window (~80 ms), then group by relay
via `routing.ts` and merge into as few filters as possible. Two hundred profile wants become one
`{kinds: [0], authors: [...]}` per relay, split only when a cap is exceeded.

**Lanes.** `interactive` is anything on screen — the avatar and display name of a visible note, an
open thread. `prefetch` is offscreen note dependencies. `background` is feed polling and follow-list
refresh. Lanes drain high-first with an anti-starvation guarantee so background work still
progresses under a fast-scrolling user.

This is the generalization of what `src/net/media.ts` already does — a 4-slot queue with
`prioritizeAsset` promoting media on viewport entry. Same idea, applied to events. Media fetches
HTTP bytes rather than relay frames, so it keeps its own budget; the two are siblings, not nested.

### The connection budget

Today's `MAX_PARALLEL_RELAYS = 8` exists because one query means one socket means one Tor circuit.
Warm multiplexed connections break that equivalence, so the budget has to be re-expressed in terms
of what is actually scarce:

| resource | cap | why |
|---|---|---|
| open connections (circuits) | 8 on Tor, higher on clearnet | circuit setup is the real cost |
| in-flight REQs per connection | 4–8 | cheap once the circuit exists |
| in-flight REQs globally | derived | backstop against a runaway fan-out |

**Do not split the connection budget between notes and metadata.** The two phases are mostly
*sequential*, not concurrent: while the first page is fetching there is no metadata to fetch yet,
and while a page hydrates the barrier is deliberately holding the next page back. A static 4/4
partition would leave half the sockets idle through both phases.

More to the point, with engagement routed to the relays a page came from, metadata needs **no new
sockets at all** — it rides the connections the page fetch already opened as extra multiplexed
REQs. The contention a split was meant to relieve mostly does not arise.

What does need protecting is starvation, and that belongs on REQ slots rather than connections.
Each lane gets a guaranteed floor of in-flight slots and may burst into whatever is idle:
hydration can't be starved by a page fetch, a page fetch can't be starved by a scroll flood, and
neither reserves capacity it isn't using.

Degraded relays back off and stop counting against the budget.

## Dependency resolution

`Note` must stop fetching. Today one note triggers `useAuthor` for its author, `useEventById` for a
reply parent, another `useAuthor` for the parent's author, one `useAuthor` per `nostr:` mention, and
`useAsset` per media URL — all per note, all as a side effect of rendering.

Instead, a pure extractor runs when an event enters the store:

```ts
export const extractWants = (event: NostrEvent): Want[] => { /* … */ };
```

It emits: the author's profile; NIP-10 reply and root e-tag ids with their relay hints and authors;
`q` tag ids; the embedded event's author for kinds 6 and 16; profiles for `nostr:npub`/`nprofile`
mentions; events for `note`/`nevent`; addressables for `naddr`.

Those enqueue at `prefetch`. A single IntersectionObserver at the feed container promotes a note's
wants to `interactive` on entry and demotes to `prefetch` on exit. Components read the results from
the store and render.

## Engagement: replies, reactions, threads

### Where replies live

Outbox routing finds an author's own output and structurally cannot find responses to it, because
responses are written by other people. But the practical answer is much narrower than the theory
suggests.

A well-behaved client posts a reply to the relays where it read the parent — that is what the `e`
tag relay hint is for, and it is the outbox model working as intended. So **the relays a page's
notes were found on are the engagement relay set.** A replier who posted somewhere unrelated has
put their reply where nobody reading the thread will look; that is their bug, and widening our
fan-out to cover it costs every user on every page.

The payoff is bigger than the simplicity. Those relays already have warm connections from the page
fetch that produced the notes, so engagement queries for an entire page cost **zero new
connections** — the scarce resource is sockets, and we open none. Each relay is asked only about
the notes it served.

When the user opens a thread, completeness starts to outweigh cost, so add one tier there: the
root author's read relays, their NIP-65 inbox, where a strictly conformant replier also sends. One
extra tier, on one note, on demand — never on every note in every page.

### Both reply formats, always

Neither subsumes the other, so both are queried.

**NIP-10** — kind 1 with `e` tags and `root` / `reply` markers, plus the legacy positional forms
where markers are absent. `nip10.parse` already handles this and is in use in `Note.tsx`.

**NIP-22** — kind 1111 comments. Uppercase tags (`E`, `K`, `P`, `A`, `I`) scope the thread root,
lowercase (`e`, `k`, `p`, `a`, `i`) point at the immediate parent. Relay tag filters are
case-sensitive, so `#E` and `#e` are different queries: `#e` gets direct children, `#E` gets
everything under a root.

Direct responses to note X — both reply formats, reactions, reposts and zaps — are one filter:

```ts
{ kinds: [1, 1111, 6, 16, 7, 9735], '#e': [X] }
```

And because `#e` takes an array, one filter covers a whole page:

```ts
{ kinds: [1, 1111, 6, 16, 7, 9735], '#e': [id1, id2, /* … */ id50] }
```

One REQ per relay for an entire page of notes. This is the property that makes per-note counts
affordable at all, and it is why engagement batching is a first-class concern of the scheduler
rather than something layered on top.

### Counts are derived, not stored

A count is an aggregate over a set, not an entity. The store's `getRefs` index is built on ingest
from `e` tags, and counts derive from it — so they update on their own as more responses land, with
no separate count cache to invalidate.

Two correctness rules that need tests:

- **replies dedupe by event id** — the same reply arrives from several relays
- **reactions dedupe by pubkey, not event id** — one person can emit many kind 7s, and the number
  the reader cares about is how many *people* reacted. NIP-25 also gives `-` content a downvote
  meaning, so likes and dislikes are separate tallies

### Bounding popular notes

A widely shared note has thousands of reactions. Downloading them all to render `2.4k` is absurd
over clearnet and unusable over Tor.

Preferred is **NIP-45 `COUNT`**, which returns an aggregate without transferring events. Relay
support is uneven, so probe once per relay and cache the capability in the `meta` store, the same
way relay degradation is cached.

Fallback is a bounded fetch with a per-target cap of around 500. When the cap is hit the number is
a floor and the UI must say so — `500+`, never a fabricated precise figure. Showing the bound is
the honest option; rounding it away is masking a limit we know about.

**Not a third-party stats provider.** NIP-85 is thinly supported, and the privacy cost would
disqualify it regardless: one provider asked about every note you scroll past holds a complete
timestamped log of your reading, which Tor does not fix. Counts stay on the relays we were already
talking to.

For once the privacy effect runs the other way too: batching fifty note ids into a single filter
means the relay learns the page, not which note held your attention.

### Threads expand one level at a time

From a note the user opens:

1. fetch direct children — one batched filter across the engagement relay set
2. when those land, fetch *their* counts — again one batched filter over all the child ids
3. children render with counts; expanding any one of them repeats from step 1

Never prefetch past one level of counts. Depth is bounded by the user's clicks; speculating a
second hop fans out exponentially on any busy thread.

### The hydration barrier

Paging forward is gated on the current page being fully described:

1. a page seals with N events
2. its metadata wants are emitted as one batch — engagement counts for all N, plus everything
   `extractWants` yields for them (authors, reply parents, quoted events, mentioned profiles,
   addressables)
3. the page is **hydrated** when those settle, or when a deadline expires
4. only then may the next `feedPage` want dispatch

Lane assignment reinforces the barrier rather than restating it: page-hydration wants sit in
`prefetch`, visible notes' wants are promoted to `interactive`, the next page request is
`background`. Lane draining alone would usually produce this order; the explicit barrier makes it
deterministic and testable.

The deadline is not optional. Without it, one dead relay in the engagement set stops the user
scrolling. A page that cannot hydrate renders with the counts it has and unblocks the next page.

## Privacy

- the store is a record of what this identity has looked at. on logout or keystore lock it is wiped
  or locked, and it is scoped per identity — switching accounts must never serve one account's
  fetch history to another
- want coalescing must not merge wants across identities. batching two accounts' interests into one
  REQ correlates them to the relay
- relay hints from event tags are attacker-controlled. sanitize to `wss://` only before they reach
  routing, and never let a hint pull a query to a relay outside the plan for an unrelated intent
- NIP-42 AUTH identity-links a connection. the store should record which relays a connection has
  AUTH'd to so the planned privacy score can read it
- polling cadence is a fingerprint. jitter the tick rather than hitting a round interval
- engagement counts never come from a central stats provider. one provider asked about every note
  you scroll past holds your complete reading history — see the engagement section
- a NIP-42 authenticated connection is identity-bound. warm sockets are dropped whenever the signer
  changes, so no relay ever sees two accounts share one authenticated connection
- all egress stays inside `src/net`. the scheduler calls the transport; nothing else does

## Testing

Pure modules carry the weight, which is the point of the layering.

| module | what the tests must prove |
|---|---|
| `routing.ts` | table-driven per intent. no-NIP-65 authors excluded; publish adds discovery only for identity kinds |
| `seal.ts` | watermark correctness at every boundary: exactly-limit, exhausted, timed-out, single relay, cross-relay duplicates |
| `store.ts` | replaceable conflict rule including the id tiebreak, resolving the same way whichever relay answers first; stable snapshot identity; ingest dedupe; provenance accumulation; settle distinct from empty |
| `slots.ts` | a lane inside its floor is always admitted; a lane may burst into unreserved capacity only; the global cap holds; a flood cannot starve `interactive` |
| `scheduler.ts` | N wants collapse to one filter; in-flight and satisfied wants do not re-queue; a dropped want never goes out; oversized author lists split; an author with a known kind 10002 is asked at their own relays and one without falls back to ours *and* queues the relay-list lookup; another person's relay list is never sought on a discovery relay; **engagement REQs reuse open connections rather than opening new ones**. against a fake transport |
| `extract.ts` | fixtures for reply, root-only reply, quote, repost, mention, naddr, malformed tags; same want implied twice is one want |
| `engagement.ts` | replies dedupe by id, reactions dedupe by pubkey, NIP-25 `-` counted as downvote, NIP-10 and NIP-22 children both counted, cap reported as a floor not a number |
| `feed/engine.ts` | **invariant: a sealed page never reorders.** pagination continuity — no gaps, no duplicates across pages, including when a page is clipped short of its watermark. the cursor does not advance when no relay answered. events a relay served but nobody proved complete are held back yet still stored. relay-supplied authors the spec never asked for are dropped. pending buffer does not render until accepted; an oversized delta re-seals from the top. attempts distinguish untried from tried-empty, or a caller retrying on "no pages" spins |
| `feed/registry.ts` | one engine per id; a changed author list drops sealed pages; the same list — in any order — keeps them, which is what survives a remount |
| `persist/codec.ts` | identity round-trips; `setCodec` is what both write and read go through |
| `persist/persist.ts` | ingest does not touch disk; timer and count thresholds flush; settle-only entities are not written; replaceable/addressable land in their own stores; a fresh store hydrates events and provenance; replaceables load in full, regular events only the recent window; a live newer event wins over a disk older one; clearing memory drops pending writes; `wipe()` empties disk |
| transport | many REQs multiplex over one socket; idle close; degraded backoff; AUTH still works |

The suite blocks real egress — a `WebSocket` constructor in a test throws. Live relays are reached
only by `*.live.test.ts` under `npm run test:live`, which is excluded from `npm test`. Those are
read-only and keyless, and exist because there is no browser harness: they are how a transport
regression gets caught as a red test instead of an empty feed.

## Phases

Each phase cuts over completely. No dual paths, no back-compat branches, no feature flags — the old
code is deleted in the same phase that replaces it.

1. **Routing.** ✅ Policy extracted into `src/data/routing.ts`, bound by `src/data/hooks/useRouting.ts`,
   with `queryTiers` to run a tiered plan. `readRelays` / `writeRelays` deleted from
   `src/lib/appRelays.ts`, which now holds only `DEFAULT_DISCOVERY_RELAYS`.
2. **Transport.** ✅ `src/net` split into `egress.ts` (bookkeeping), `io.ts` (the two raw
   transports), `pool.ts` (warm multiplexed connections) and `net.ts` (protocol + public surface).
   `queryRelay` / `queryRelays` / `publish` keep their signatures. Publishing now rides the warm
   connection too, so the `relay_publish` Rust command was deleted — the stream bridge carries
   EVENT frames like any other.
3. **Store, scheduler, hooks.** ✅ In memory. `store.ts` (entity-keyed, stable snapshots),
   `slots.ts` (REQ budgeting with lane floors), `scheduler.ts` (wants, debounced coalescing,
   outbox grouping), `context.ts` (self + author relays off the store), and the
   `useEntity` / `useProfile` / `useRelayList` / `useProfiles` hooks over `useSyncExternalStore`.
   `DataProvider` pushes identity and relay config in. Kind 0 and kind 10002 now have exactly one
   home: `useAuthor`, `useProfileRelays` and `useProfileMetadata` are deleted, `useCurrentUser` is
   identity-only, and `useLoggedInAccounts` and `useEventById` read the store instead of fetching
   their own copies.
4. **Feed engine.** ✅ `feed/seal.ts` (completeness watermark), `feed/spec.ts` (a feed is a
   parameter, so the private-feed NIP will be a new spec rather than a second pipeline),
   `feed/engine.ts` (sealed pages, `until` pagination, `since` polling, the pending buffer) and
   `feed/registry.ts` (engines outlive the component tree, so navigating back does not refetch).
   `useFeed` binds it and declares the follows' kind 10002 as wants of its own. `useOutboxFeed`,
   `mergeFeed` and `mergeRelays.ts` are deleted. `queryRelayResult` was added to `net.ts` because
   the watermark is uncomputable without knowing whether a relay sent EOSE or simply ran out of
   time.
5. **Persistence.** ✅ `persist/db.ts` (schema, `seq`-only index), `persist/codec.ts` (async
   identity encode/decode), `persist/persist.ts` (write-behind + hydration). The store gained
   `watch` / `restore` so disk I/O is not on the ingest path and hydration does not echo back as
   writes. `DataProvider` starts the persister on mount. `hydrateFromStore` lets the feed render
   the cached window immediately.
6. **Extractor, visibility, engagement.** ✅ `extract.ts` (event → wants), `engagement.ts`
   (counts from the ref index), `resolver.ts` (ingest enqueues prefetch). Scheduler wants now
   include `event`, `addressable`, `engagement` and `followList`. `useEvent` / `useEngagement` /
   `useVisibility` / `useBootstrap` replace `useEventById`, `useEventFetch` and `useNostrSync`.
   A page's `hydrated` flag plus a deadline is the hydration barrier. Counts never leave the
   relays a note was found on — no NIP-85 provider, no new circuits.
7. **Thread view.** ✅ Direct children via a `thread` want (found-on relays plus the root
   author's inbox). `childrenOf` / `isDirectChild` keep NIP-22 `#E` out of the first hop.
   Expanding a child is another want. Profile notes, following, and follower sample are
   scheduler wants; `src/hooks/useProfile.ts` and the last Nostr `useQuery` surfaces are gone.
   TanStack Query remains only for mutations.

### Provider placement

`DataResolverProvider` needs auth, user state and app config, and replaces the `useNostrSync` call
in `AppRoot`:

```
AppProvider
    UserStateProvider
        KeystoreProvider
            NostrLoginProvider
                DataResolverProvider   <- here
                    AppRoot
```

### Deleted by the end

`useAuthor`, `useProfileRelays`, `useProfileMetadata`, `useProfileNotes`, `useProfileFollows`,
`useProfileFollowerSample`, `useEventFetch`, `useEventById`, `useOutboxFeed`, `useNostrSync`,
`mergeFeed`, `mergeRelays`, the kind 0 fetch inside `useLoggedInAccounts`, and TanStack Query for
Nostr data.
