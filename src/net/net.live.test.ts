import { afterAll, describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools';
import { closeAllConnections, poolStatus, queryRelay, queryRelays } from './net';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';

/**
 * Real relays, real sockets. Run with `npm run test:live` — excluded from the
 * normal suite. This is the closest thing to "open the app and look at a
 * feed" that works without a browser: it exercises the actual transport
 * against live relays, so a regression in the pool shows up as a red test
 * rather than an empty feed.
 *
 * Reads only. Nothing here signs, publishes, or needs a key.
 */

/**
 * Test-only. The app never hardcodes content relays — it routes by NIP-65 —
 * but a live check needs one relay known to carry kind 1 at any hour.
 * Discovery relays deliberately carry none, so they cannot stand in.
 */
const CONTENT_RELAY = 'wss://relay.damus.io/';

afterAll(() => closeAllConnections());

describe('live transport', () => {
    it('returns verifiable events and terminates on EOSE', async () => {
        const events = await queryRelay(CONTENT_RELAY, [{ kinds: [1], limit: 10 }]);

        expect(events.length).toBeGreaterThan(0);
        for (const event of events) {
            expect(event.kind).toBe(1);
            expect(verifyEvent(event)).toBe(true);
        }
    });

    it('serves concurrent queries over a single socket', async () => {
        const [notes, profiles] = await Promise.all([
            queryRelay(CONTENT_RELAY, [{ kinds: [1], limit: 5 }]),
            queryRelay(CONTENT_RELAY, [{ kinds: [0], limit: 5 }]),
        ]);

        expect(notes.length).toBeGreaterThan(0);
        expect(profiles.length).toBeGreaterThan(0);
        expect(notes.every((e) => e.kind === 1)).toBe(true);
        expect(profiles.every((e) => e.kind === 0)).toBe(true);
        expect(poolStatus().filter((c) => c.url === CONTENT_RELAY)).toHaveLength(1);
    });

    it('keeps the connection warm between queries', async () => {
        await queryRelay(CONTENT_RELAY, [{ kinds: [1], limit: 1 }]);
        expect(poolStatus().map((c) => c.url)).toContain(CONTENT_RELAY);

        await queryRelay(CONTENT_RELAY, [{ kinds: [1], limit: 1 }]);
        expect(poolStatus().filter((c) => c.url === CONTENT_RELAY)).toHaveLength(1);
        // Subscription closed on completion; the socket outlives it.
        expect(poolStatus().find((c) => c.url === CONTENT_RELAY)?.subs).toBe(0);
    });

    it('fans out across relays and dedupes by event id', async () => {
        const notes = await queryRelay(CONTENT_RELAY, [{ kinds: [1], limit: 5 }]);
        const authors = [...new Set(notes.map((e) => e.pubkey))];
        expect(authors.length).toBeGreaterThan(0);

        // The same authors from several relays at once: any given kind 0 is
        // likely to come back from more than one, so this proves dedupe.
        const profiles = await queryRelays(
            [CONTENT_RELAY, ...DEFAULT_DISCOVERY_RELAYS],
            [{ kinds: [0], authors }],
        );

        expect(new Set(profiles.map((e) => e.id)).size).toBe(profiles.length);
        for (const profile of profiles) {
            expect(authors).toContain(profile.pubkey);
            expect(verifyEvent(profile)).toBe(true);
            expect(() => JSON.parse(profile.content)).not.toThrow();
        }
    });

    it('discovery relays answer the lookups they exist for', async () => {
        // Their whole job: kind 0 and kind 10002 for a pubkey we just saw.
        const notes = await queryRelay(CONTENT_RELAY, [{ kinds: [1], limit: 20 }]);
        const authors = [...new Set(notes.map((e) => e.pubkey))].slice(0, 10);

        const lists = await queryRelays(
            [...DEFAULT_DISCOVERY_RELAYS],
            [{ kinds: [0, 10002], authors }],
        );

        for (const event of lists) {
            expect([0, 10002]).toContain(event.kind);
            expect(authors).toContain(event.pubkey);
            expect(verifyEvent(event)).toBe(true);
        }
    });
});
