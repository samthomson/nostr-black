# nostr.black

This is a privacy focused nostr client.
The idea is to start the user from a point of sensible privacy defualts. Such that they have to go choose to do things that will be public. This is different to nostr today, where everything is public by default.

## Principles

1. **Private by default** — every action is private unless the user explicitly chooses public.
2. **Public is an informed opt-in** — when something will be public, the client shows exactly how public.

## Stack

- web: static React SPA cloned from MKStack (Nostrify, TanStack Query) — requires Tor Browser
- desktop: Tauri wrapping the same React app, bundled Tor (arti); all egress through Tor
- login: extension or bunker only; no nsec pasting

## Use cases

- I can follow people without anyone seeing who I follow
  - I can see notes from all the people I follow (outbox model)
  - I can import my existing public follow list into a private one
  - if another app republishes my follows publicly, I'm told and offered a restore (ie if I follow someone publicly in another client)
- I can read and browse without relays learning my IP
- I can react to a note so only its author ever knows
- I can reply to someone without the reply being public
- I can zap without a public receipt
- when I post (which is public), the client shows me exactly how public it is (privacy score)
  - I can post publicly from a burner not linked to my main account
- I can set my own per-action defaults (e.g. public reactions)

## Private NIPs

| Feature | NIPs | Status |
|---|---|---|
| Private follow list | [51](https://github.com/nostr-protocol/nips/blob/master/51.md) | planned |
| Private feed | TBD | planned |

## Privacy features

| Feature | Notes | Status |
|---|---|---|
| Follow import, cache & restore | cache setting on by default | planned |
| Network privacy | web: requires Tor Browser (client-side IsTor check); desktop: Tor bundled | planned |
| Privacy score | NIP-42 AUTH'd connections are identity-linked — feeds into the score | planned |
| Privacy default settings | | planned |
| How your activity looks from the outside | | planned |
| Obfuscate client tag | | planned |
| EXIF handling | strip all by default; optional obfuscation rewrites locations to random pre-selected places | planned |
| Burner upload server | shared default server, client-local setting, not a published 10063 list — burners are single-use | planned |
| Upload entropy | setting, on by default: uploads get unique bytes so blob hashes never repeat across identities | planned |
| Encrypted local cache | | planned |

## Normal features

| Feature | Notes | Status |
|---|---|---|
| Outbox model | via [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) relay lists | planned |
| Key management | extension or bunker only ([NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md), [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md)); no nsec pasting | planned |
| Threaded/fan feed UI | comment counts upfront; clicking a note with replies opens a column of replies to the right, repeating indefinitely; columns at the far left/right edges bunch together; the user never loses their place in a discussion; seen-state tracked | planned |
| Tor-failure placeholders | relays/media that fail over Tor get flagged with a placeholder; the feed moves on | planned |
| Relay feeds | intelligently source and recommend relays to post to | planned |
| Client-side filters | subscribe to relays with client-side filters (ie remove all mastodon) | planned |
| Multiple accounts | add/switch accounts, switched account defines the app experience; per-post dropdown posts from a burner without re-logging; with multiple accounts added, the publish button names the current account ("publish as john") to prevent accidental postings | planned |
| Publish queue | outbound events are signed and broadcast immediately, retried on failure; connectivity loss never loses events | planned |
| Media uploads | via Blossom ([NIP-B7](https://github.com/nostr-protocol/nips/blob/master/B7.md)) to the account's `kind:10063` servers | planned |

## Open questions

- private messages — [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) exists; uncommitted
- private reactions — no spec for reactions to public notes; would be a NIP-59 application
- private replies — no dedicated NIP
- private zaps — [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) defers private zaps to future work
- private groups — nothing exists that doesn't trust a relay
- proof-of-work on burner notes/replies to avoid relay spam filtering — [NIP-13](https://github.com/nostr-protocol/nips/blob/master/13.md)

## Tradeoffs

- Public-first clients can't render the private follows etc. — accepted, that is the point.
- Outbox fetching + gift-wrap unwrapping means more relay connections and decryption work than firehose clients — slower feed, accepted.
