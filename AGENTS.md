# nostr.black — agent guidance

Plan of record: `README.md`.

## Conduct

- be concise in dialog always. use no more words than needed
- no preambles, no recaps, no "what shipped" summaries. the diff is the answer
- do only what is explicitly instructed. suggest additional tasks, never implement unapproved ideas or flesh out beyond what was asked
- output must be product relevant: code, plans, technical docs. no marketing speak or filler
- read before writing; never overwrite user-authored content
- do not plan for failure: build features that work. surface errors, never mask them — no swallowed catches, fallback values, or graceful-degradation UI hiding a bug
- one correct way, no legacy fallbacks. pre-launch: no migrations, no back-compat branches, no old-shape guards. change the schema and move on

## Git

- never run `git commit`, `--amend`, `push`, or any history-mutating command unless explicitly asked for that exact action in the current message. "build it"/"ship it" does not authorize a commit. leave the tree dirty; the user commits

## Privacy doctrine (non-negotiable)

- value privacy of client users; raise alarms about any NIPs etc being implemented that will reveal the user's info publicly
- private by default: anything that publishes publicly must be a deliberate, visible opt-in
- keys: extension (NIP-07) or bunker (NIP-46) only. never facilitate nsec pasting, never store keys
- all network egress goes through the egress module (`src/net`) — no direct `fetch`, `WebSocket`, or media loads anywhere else. desktop routes it through Tor; web gates on the IsTor check
- nothing loads off-origin: no third-party CDNs, fonts, analytics
- treat any new metadata an event would publish (client tag, relay lists, follows, upload hashes) as a leak until proven intentional
- check existing NIPs before building anything; prefer existing NIPs/kinds over custom ones
- XSS here compromises the signer: never `innerHTML` with event data; sanitize event-sourced URLs (https-only) and CSS strings; keep the CSP strict

## Code style

- TypeScript, never `any`
- const arrow functions; async/await, no `.then()` ladders
- lowercase UI copy (labels, buttons, status)
- shadcn/ui components (`src/components/ui`), Tailwind, `cn()` merge; skeletons for loading, spinners only for buttons
- read `App.tsx`, `AppRouter.tsx`, `NostrProvider` before touching them
- package manager: npm

## Tests & validation

- write tests for everything. tests must be intelligent and critically cover the features — behavior, boundaries, invariants, real error paths — not plumbing or source-text checks
- after code changes: typecheck → build → lint (fix critical) → run the test suite. not done until they pass
- verify UI changes by browser-driving the dev server
