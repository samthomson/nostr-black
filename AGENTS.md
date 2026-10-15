# nostr.black — agent guidance

Plan of record: `README.md`.

## Conduct

- be concise in dialog always. use no more words than needed
- hard caps: answers ≤5 lines unless a decision genuinely needs more; task-done replies are one line; explanations max 3 bullets, only when asked or load-bearing. never restate known context, never summarize completed work unprompted, never preview next steps unprompted
- when answering multiple questions in one message, lead each answer with a bolded one-sentence summary of its question, comprehensible on its own
- programming-style feedback from the user is captured here as rules. components stay thin and dumb (props in, render out); generic deterministic pure functions live once in `src/lib` utils, never duplicated inside components
- output must be product relevant: code, plans, technical docs. no marketing speak or filler
- read before writing; never overwrite user-authored content
- user-facing copy is user-authored: never modify, rewrite, or "improve" existing copy (UI text, landing pages, error messages, README prose) without explicit permission in the current conversation. propose options; do not apply
- do not plan for failure: build features that work. surface errors, never mask them — no swallowed catches, fallback values, or graceful-degradation UI hiding a bug
- no silent fallbacks, ever. a missing prerequisite (relay list not synced, config absent, empty input) is surfaced to the user or explicitly awaited — never papered over with fallback data that silently proceeds. fallbacks mask bugs and ship them. the sole exception is the cold-start discovery bootstrap before the user's relay list syncs, and a miss on that fallback must never be treated as a verdict
- code is written for the scanning developer: readable top-to-bottom like prose, named types and helpers (never compiler plumbing like `Parameters<typeof fn>[…]`), and functions small enough that each states one plain idea. if the flow can't be followed by scanning, rewrite it
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
- buttons / chips / tags are near-square — use `rounded-sm` only (token is ~2px). never `rounded-md`/`rounded-lg`/`rounded-xl`/`rounded-full`/pills for chrome
- privacy is colour: private=black, public=white, greys between (low/medium/high). all privacy-coloured buttons/pills/labels use the consts in `src/lib/privacy.ts` (text is the inversion) — never ad-hoc colours
- `PrivacyTag` and similar inline labels inherit font-size from their parent — never hardcode `text-[Npx]` / `text-xs` on them
- images (avatars, banners, media): spinner or skeleton while loading — never letter/initials/npub-slice text placeholders. empty muted only when there is no image. all avatars go through `ProfileAvatar` + `useAsset`
- mobile: header with hamburger drawer below `md`; desktop keeps the side rail. use `h-dvh` and safe-area insets
- read `App.tsx`, `AppRouter.tsx`, `NostrProvider` before touching them
- json is always formatted with 4-space indentation
- structure by domain with clear module boundaries. deterministic pure functions live once in `src/lib` and slot into complex call sites, so the complex places hold less code and read easily
- one concern per file: e.g. AppRouter is just routes, templates live in their own component

## Tests & validation

- write tests for everything. tests must be intelligent and critically cover the features — behavior, boundaries, invariants, real error paths — not plumbing or source-text checks
- fixed test identities are fine: hardcode dedicated keypairs created for testing (reused across runs is good) so tests exercise real nostr events end-to-end — the most realistic data. never real user identities
- after code changes: typecheck → build → lint (fix critical) → run the test suite. not done until they pass
- verify UI changes by browser-driving the dev server
