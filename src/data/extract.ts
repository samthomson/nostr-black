import type { NostrEvent } from '@nostrify/nostrify';
import { nip10, nip19 } from 'nostr-tools';
import { wantKey, type Want } from './scheduler';

/**
 * What an event implies we also need.
 *
 * Runs when an event enters the store. The UI never walks tags itself to
 * decide what to fetch — that is how one note used to fire five independent
 * requests. Everything here enqueues at `prefetch`; visibility promotes.
 *
 * See `docs/data-layer.md` § Dependency resolution.
 */

const HEX = /^[0-9a-f]{64}$/i;
const MENTION = /(?:nostr:|@)((?:npub|nprofile|note|nevent|naddr)1[a-z0-9]+)/gi;

const push = (out: Want[], want: Want): void => {
  out.push(want);
};

const mentionWants = (content: string): Want[] => {
  const out: Want[] = [];
  for (const match of content.matchAll(MENTION)) {
    const bech32 = match[1];
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(bech32);
    } catch {
      // Malformed bech32 in untrusted content is the author's, not ours.
      continue;
    }

    if (decoded.type === 'npub') {
      push(out, { type: 'profile', pubkey: decoded.data });
    } else if (decoded.type === 'nprofile') {
      push(out, { type: 'profile', pubkey: decoded.data.pubkey });
    } else if (decoded.type === 'note') {
      push(out, { type: 'event', id: decoded.data });
    } else if (decoded.type === 'nevent') {
      push(out, {
        type: 'event',
        id: decoded.data.id,
        author: decoded.data.author,
        hints: decoded.data.relays,
      });
    } else if (decoded.type === 'naddr') {
      push(out, {
        type: 'addressable',
        kind: decoded.data.kind,
        pubkey: decoded.data.pubkey,
        d: decoded.data.identifier,
      });
      push(out, { type: 'profile', pubkey: decoded.data.pubkey });
    }
  }
  return out;
};

const tagEvent = (id: string | undefined, relay?: string, author?: string): Want | undefined => {
  if (!id || !HEX.test(id)) return undefined;
  return {
    type: 'event',
    id,
    author: author && HEX.test(author) ? author : undefined,
    hints: relay ? [relay] : undefined,
  };
};

const embeddedRepost = (event: NostrEvent): Want[] => {
  if (event.kind !== 6 && event.kind !== 16) return [];
  const out: Want[] = [];

  try {
    const inner = JSON.parse(event.content) as { id?: string; pubkey?: string };
    if (inner.id && HEX.test(inner.id)) {
      push(out, { type: 'event', id: inner.id, author: inner.pubkey });
    }
    if (inner.pubkey && HEX.test(inner.pubkey)) {
      push(out, { type: 'profile', pubkey: inner.pubkey });
    }
  } catch {
    // Kind 6 with no JSON body is valid — the e tag is the pointer.
  }

  const e = event.tags.find(([name]) => name === 'e');
  const want = tagEvent(e?.[1], e?.[2], e?.[3]);
  if (want) push(out, want);
  if (e?.[3] && HEX.test(e[3])) push(out, { type: 'profile', pubkey: e[3] });

  return out;
};

/** Every want this event implies, deduped. Author profile is always first. */
export const extractWants = (event: NostrEvent): Want[] => {
  const out: Want[] = [];

  if (HEX.test(event.pubkey)) {
    push(out, { type: 'profile', pubkey: event.pubkey });
  }

  const parsed = nip10.parse(event);
  const reply = parsed.reply ?? parsed.root;
  if (reply) {
    const want = tagEvent(reply.id, reply.relays?.[0], reply.author);
    if (want) push(out, want);
    if (reply.author && HEX.test(reply.author)) {
      push(out, { type: 'profile', pubkey: reply.author });
    }
  }

  for (const [name, id, relay, author] of event.tags) {
    if (name === 'q') {
      const want = tagEvent(id, relay, author);
      if (want) push(out, want);
      if (author && HEX.test(author)) push(out, { type: 'profile', pubkey: author });
    }
    if (name === 'p' && id && HEX.test(id)) {
      push(out, { type: 'profile', pubkey: id });
    }
  }

  out.push(...embeddedRepost(event));
  out.push(...mentionWants(event.content));

  const seen = new Set<string>();
  return out.filter((want) => {
    const key = wantKey(want);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
