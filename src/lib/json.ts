/**
 * JSON syntax tokens: the pure half of JSON display. The renderer maps
 * each token kind to its theme class — this module only decides what
 * each substring is.
 */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'keyword' | 'punct';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const TOKEN_PATTERN =
  /("(?:[^"\\]|\\.)*")(\s*:\s*)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[],:])/g;

/** Deterministic tone index for a JSON key: same key always lands on
 * the same colour across renders and sessions (djb2 over the name). */
export const jsonKeyTone = (key: string, toneCount: number): number => {
  let hash = 5381;
  for (const ch of key) hash = ((hash * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash % toneCount;
};

/** Tokenize pretty-printed JSON into kinds for the renderer. Anything
 * the pattern misses (whitespace between values) passes through as
 * punctuation — the renderer styles it quiet. */
export const jsonTokens = (source: string): readonly JsonToken[] => {
  const tokens: JsonToken[] = [];
  let at = 0;
  TOKEN_PATTERN.lastIndex = 0;
  for (let match = TOKEN_PATTERN.exec(source); match !== null; match = TOKEN_PATTERN.exec(source)) {
    if (match.index > at) tokens.push({ kind: 'punct', text: source.slice(at, match.index) });
    const [whole, quoted, colon, numeric, keyword] = match;
    if (quoted !== undefined) {
      tokens.push(colon !== undefined
        ? { kind: 'key', text: whole }
        : { kind: 'string', text: quoted });
    } else if (numeric !== undefined) {
      tokens.push({ kind: 'number', text: numeric });
    } else if (keyword !== undefined) {
      tokens.push({ kind: 'keyword', text: keyword });
    } else {
      tokens.push({ kind: 'punct', text: whole });
    }
    at = match.index + whole.length;
  }
  if (at < source.length) tokens.push({ kind: 'punct', text: source.slice(at) });
  return tokens;
};

/** Literal tone classes — Tailwind generates CSS only for classes it
 * can see in source, so the list must never be built dynamically. */
export const KEY_TONE_CLASS: readonly string[] = [
  'text-json-key-1',
  'text-json-key-2',
  'text-json-key-3',
  'text-json-key-4',
  'text-json-key-5',
  'text-json-key-6',
];

/** The colour class for a key or field name: deterministic across
 * renders and sessions. */
export const toneClass = (name: string): string =>
  KEY_TONE_CLASS[jsonKeyTone(name, KEY_TONE_CLASS.length)];

/** Canonical field order for a nostr event: the NIP-01 reading order —
 * relays and clients serialize in whatever order they built the
 * object, so the raw view normalizes instead of showing that noise. */
const EVENT_KEY_ORDER: readonly string[] = [
  'id',
  'kind',
  'pubkey',
  'content',
  'tags',
  'created_at',
  'sig',
];
export const canonicalJson = (value: object): string => {
  const record = value as Record<string, unknown>;
  const keys = [
    ...EVENT_KEY_ORDER.filter((key) => key in record),
    ...Object.keys(record).filter((key) => !EVENT_KEY_ORDER.includes(key)),
  ];
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, record[key]])), null, 4);
};
