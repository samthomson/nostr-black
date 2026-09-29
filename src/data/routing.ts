import type { NostrEvent } from '@nostrify/nostrify';
import { buildRelayGroups, type RelayList } from '@/lib/outbox';

/**
 * Relay selection policy. The only module in the app that decides which
 * relays a request goes to.
 *
 * Pure: no hooks, no context, no network. Callers supply the world
 * (`RoutingContext`) and an `Intent`, and get back a plan.
 *
 * See `docs/data-layer.md` for the reasoning behind each intent.
 */

/** A relay entry from the user's own NIP-65 list. */
export interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

/** What the app knows about itself: who we are, and where *we* read and write. */
export interface SelfRelays {
  /** The logged-in user, if any. Their own lookups route differently. */
  pubkey?: string;
  /** The user's NIP-65 list as synced. Empty until the first sync lands. */
  myRelays: readonly RelayEntry[];
  /** App discovery relays — bootstrap, and publishing discoverable kinds. */
  discovery: readonly string[];
}

/**
 * Where other people publish, from their kind 10002. Lookup is the only
 * operation routing needs, so the event store can back this directly
 * instead of anyone materializing a Map of every author in the feed.
 * A plain `Map` satisfies it.
 */
export interface AuthorRelays {
  get(pubkey: string): RelayList | undefined;
}

/** Self, plus what we know about where other people publish. */
export interface RoutingContext extends SelfRelays {
  authorRelays: AuthorRelays;
}

/**
 * Subjects a relay is being asked about — pubkeys or event ids depending on
 * the intent. Empty means the request carries no per-relay narrowing.
 */
export type Subjects = readonly string[];

/** relay url → the subjects that relay is being asked about. */
export interface RelayTier {
  groups: ReadonlyMap<string, Subjects>;
}

/** Tiers are attempted in order; a later tier only runs if earlier ones came up empty. */
export interface RelayPlan {
  tiers: readonly RelayTier[];
}

export type Intent =
  /** The user's own kind 0 / 3 / 10002, before anything else is known. */
  | { kind: 'bootstrap'; pubkey: string }
  /** Feed: many authors at once, via each author's declared write relays. */
  | { kind: 'manyAuthors'; authors: readonly string[] }
  /** One author's own events. */
  | { kind: 'oneAuthor'; pubkey: string; hints?: readonly string[] }
  /** A specific event, by id. */
  | { kind: 'resolveById'; id: string; author?: string; hints?: readonly string[] }
  /** Replies and reactions to notes we already hold. */
  | {
      kind: 'engagement';
      targets: readonly { id: string; foundOn: readonly string[] }[];
      /** Set only for an opened thread — adds the root author's inbox. */
      rootAuthor?: string;
    }
  | { kind: 'publish'; event: NostrEvent };

/**
 * Kinds whose whole purpose is to be findable by strangers, so publishing
 * them also hits the discovery relays.
 *
 * Everything else — including encrypted NIP-51 lists — goes to the user's
 * write relays only. A private list broadcast widely still leaks when it
 * changed and how often, even though its content is unreadable.
 */
export const DISCOVERABLE_KINDS: ReadonlySet<number> = new Set([0, 3, 10002, 10063]);

/**
 * Relay URLs reach us from event tags and are attacker-controlled. Anything
 * that is not a websocket URL never becomes a connection.
 */
const RELAY_URL = /^wss?:\/\/\S+$/;

const clean = (urls: Iterable<string>): string[] => [
  ...new Set([...urls].filter((u) => RELAY_URL.test(u))),
];

/** The user's own read relays, falling back to discovery until synced. */
export const myReadRelays = (self: SelfRelays): string[] => {
  const mine = clean(self.myRelays.filter((r) => r.read).map((r) => r.url));
  return mine.length > 0 ? mine : clean(self.discovery);
};

/** The user's own write relays, falling back to discovery until synced. */
export const myWriteRelays = (self: SelfRelays): string[] => {
  const mine = clean(self.myRelays.filter((r) => r.write).map((r) => r.url));
  return mine.length > 0 ? mine : clean(self.discovery);
};

/**
 * Coverage order: most subjects first, then url for stability. Only applies
 * where relays differ in how much they cover — asking the widest relay
 * first means later ones may already be satisfied.
 */
const byCoverage = (groups: Map<string, string[]>): ReadonlyMap<string, Subjects> =>
  new Map(
    [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    ),
  );

/**
 * Every relay in the tier asked about the same subjects. Caller order is
 * preserved — coverage is equal everywhere here, so the only meaningful
 * ordering is the precedence the intent asked for (ours before discovery,
 * the author's own relays before hints).
 */
const uniform = (urls: Iterable<string>, subjects: Subjects): RelayTier => {
  const groups = new Map<string, Subjects>();
  for (const url of clean(urls)) groups.set(url, [...subjects]);
  return { groups };
};

const authorWrite = (ctx: RoutingContext, pubkey: string | undefined): string[] =>
  pubkey ? clean(ctx.authorRelays.get(pubkey)?.write ?? []) : [];

const authorRead = (ctx: RoutingContext, pubkey: string | undefined): string[] =>
  pubkey ? clean(ctx.authorRelays.get(pubkey)?.read ?? []) : [];

export const relayPlan = (intent: Intent, ctx: RoutingContext): RelayPlan => {
  switch (intent.kind) {
    case 'bootstrap': {
      // A warm start already knows where we write, so ask there too. On a
      // cold start myWriteRelays falls back to discovery, which makes this
      // discovery-only — exactly as intended when nothing is known yet.
      return {
        tiers: [uniform([...myWriteRelays(ctx), ...ctx.discovery], [intent.pubkey])],
      };
    }

    case 'manyAuthors': {
      // Outbox: each relay is asked only about the authors that declared it.
      // Authors with no NIP-65 list are not queried at all — we never widen
      // to a firehose to cover them.
      const groups = buildRelayGroups([...intent.authors], ctx.authorRelays);
      const cleaned = new Map<string, string[]>();
      for (const [url, authors] of groups) {
        if (RELAY_URL.test(url)) cleaned.set(url, authors);
      }
      return { tiers: cleaned.size > 0 ? [{ groups: byCoverage(cleaned) }] : [] };
    }

    case 'oneAuthor': {
      // Own notes live on our write relays even before a kind 10002 is in
      // the store — that list is already in `myRelays`. Strangers still
      // route only by their published outbox.
      const own = clean([
        ...authorWrite(ctx, intent.pubkey),
        ...(intent.pubkey === ctx.pubkey ? myWriteRelays(ctx) : []),
        ...(intent.hints ?? []),
      ]);
      const tiers: RelayTier[] = [];
      if (own.length > 0) tiers.push(uniform(own, [intent.pubkey]));
      tiers.push(uniform(myReadRelays(ctx), [intent.pubkey]));
      return { tiers };
    }

    case 'resolveById': {
      // Hints first: a reply usually lives on the same relays as its parent.
      // Our own read relays before the author's, because they are few, warm,
      // and need no kind 10002 lookup to discover.
      const tiers: RelayTier[] = [];
      const hints = clean(intent.hints ?? []);
      if (hints.length > 0) tiers.push(uniform(hints, [intent.id]));
      tiers.push(uniform(myReadRelays(ctx), [intent.id]));
      const write = authorWrite(ctx, intent.author);
      if (write.length > 0) tiers.push(uniform(write, [intent.id]));
      return { tiers };
    }

    case 'engagement': {
      // Replies belong on the relays that served the note — that is the
      // outbox model working as intended, and those connections are already
      // warm. Each relay is asked only about the notes it served.
      const groups = new Map<string, string[]>();
      for (const target of intent.targets) {
        for (const url of clean(target.foundOn)) {
          const ids = groups.get(url) ?? [];
          ids.push(target.id);
          groups.set(url, ids);
        }
      }
      const tiers: RelayTier[] = [];
      if (groups.size > 0) tiers.push({ groups: byCoverage(groups) });

      // Only for an opened thread, where completeness outweighs cost.
      const inbox = authorRead(ctx, intent.rootAuthor);
      if (inbox.length > 0) {
        tiers.push(uniform(inbox, intent.targets.map((t) => t.id)));
      }
      return { tiers };
    }

    case 'publish': {
      const targets = DISCOVERABLE_KINDS.has(intent.event.kind)
        ? [...myWriteRelays(ctx), ...ctx.discovery]
        : myWriteRelays(ctx);
      return { tiers: [uniform(targets, [])] };
    }
  }
};

/** Every relay in a plan, deduped, tier order preserved. */
export const flattenPlan = (plan: RelayPlan): string[] => [
  ...new Set(plan.tiers.flatMap((t) => [...t.groups.keys()])),
];

/** The relays in one tier, in plan order. */
export const tierRelays = (tier: RelayTier): string[] => [...tier.groups.keys()];
