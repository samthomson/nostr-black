import { useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Check, ChevronDown } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Dialog,
  SmoothDialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RelayPill, Chip } from '@/components/Pills';
import { profileHref, eventHref } from '@/lib/format';
import { canonicalJson, jsonTokens, toneClass, type JsonTokenKind } from '@/lib/json';
import { CopyButton, CopyValue } from '@/components/CopyValue';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { isPrivateKind, privateNoteLayers, type EventLayer } from '@/lib/feedEncryption';
import { useRouting } from '@/data/hooks/useRouting';
import { useAppContext } from '@/hooks/useAppContext';
import { useRelayList } from '@/data/hooks/useProfile';

/** One row of a parsed field: toned label (same deterministic palette
 * as the JSON keys), value at the shared xs size, and — when `copy` is
 * given — a copy button that fades in on row hover at the row's right
 * edge. */
const Row = ({ label, children, copy }: { label: string; children: React.ReactNode; copy?: string }) => (
  <div className="group/row flex items-start gap-2 text-xs">
    <span className={cn('w-16 shrink-0 pt-0.5', toneClass(label))}>{label}</span>
    <span className="flex min-w-0 flex-1 items-start justify-between gap-2">
      <span className="min-w-0 break-all">{children}</span>
      {copy !== undefined && (
        <CopyButton
          value={copy}
          className="shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
        />
      )}
    </span>
  </div>
);

/** Open-by-default section toggle — the same expanding-row language as
 * the edit-history dialog. */
const Toggle = ({ title, children }: { title: string; children: React.ReactNode }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-sm border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-xs"
      >
        <span>{title}</span>
        <ChevronDown className={cn('text-muted-foreground size-4 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="border-t px-3 py-3">{children}</div>}
    </div>
  );
};

/** Pretty JSON, 4-space indent per the house style. Fields read in
 * the canonical nostr order (canonicalJson), keys take a deterministic
 * tone, and hovering a value shows a copy button right after it.
 * Exported for the broadcast queue viewer, which previews its own
 * events. */

const TOKEN_CLASS: Record<Exclude<JsonTokenKind, 'key'>, string> = {
  string: 'text-foreground',
  number: 'text-foreground/80',
  keyword: 'text-foreground/80',
  punct: 'text-muted-foreground/60',
};

const keyName = (tokenText: string): string =>
  tokenText.replace(/^"/, '').replace(/":?\s*$/, '');

export const JsonBlock = ({ value, className }: { value: NostrEvent | RumorJson; className?: string }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  // The copy button floats just right of the hovered value — after it,
  // not in some far gutter — absolutely positioned so the comma after
  // the value never moves, clamped so it can't leave the pane.
  const [copyAt, setCopyAt] = useState<{ raw: string; top: number; left: number } | undefined>(undefined);

  const hover = (event: React.MouseEvent<HTMLSpanElement>, raw: string): void => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const span = event.currentTarget.getBoundingClientRect();
    const pane = wrap.getBoundingClientRect();
    const left = Math.min(span.right - pane.left + 6, wrap.clientWidth - 26);
    setCopyAt({ raw, top: span.top - pane.top, left });
  };

  return (
    <div
      ref={wrapRef}
      data-testid="json-block"
      className={cn('relative overflow-hidden rounded-sm bg-muted', className)}
      onMouseLeave={() => setCopyAt(undefined)}
    >
      <pre className="h-full w-full overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {jsonTokens(canonicalJson(value)).map((token, i) => {
          if (token.kind === 'key') {
            return (
              <span key={i} className={toneClass(keyName(token.text))}>
                {token.text}
              </span>
            );
          }
          if (token.kind === 'string' || token.kind === 'number' || token.kind === 'keyword') {
            const raw = token.kind === 'string' ? token.text.slice(1, -1) : token.text;
            return (
              <span
                key={i}
                className={cn(TOKEN_CLASS[token.kind], 'cursor-default rounded-sm hover:bg-foreground/10')}
                onMouseEnter={(event) => hover(event, raw)}
              >
                {token.text}
              </span>
            );
          }
          return <span key={i} className={TOKEN_CLASS[token.kind]}>{token.text}</span>;
        })}
      </pre>
      {copyAt !== undefined && (
        <CopyButton value={copyAt.raw} className="absolute z-10 bg-muted" style={{ top: copyAt.top, left: copyAt.left }} />
      )}
    </div>
  );
};

export type RumorJson = { kind: number; [key: string]: unknown };

const layerTitle = (layer: EventLayer, i: number): string => {
  const kind = typeof layer.decoded === 'object' && layer.decoded !== null && 'kind' in layer.decoded
    ? ` (kind ${String(layer.decoded.kind)})`
    : '';
  return `layer ${i + 1} · ${layer.name}${kind}`;
};

/** One relay row — the same host chips notes use, on its own divided
 * line so the url and its status line up down the whole list. */
const RelayRow = ({ url, found, planned }: { url: string; found: boolean; planned: boolean }) => (
  <li className="flex items-center justify-between gap-3 px-3 py-2.5">
    <RelayPill url={url} className="text-xs" />
    <span className={cn('shrink-0 text-xs', found ? 'text-copper font-medium' : 'text-muted-foreground')}>
      {found ? (
        <span className="inline-flex items-center gap-1">
          <Check aria-hidden="true" className="size-3" />
          found
        </span>
      ) : (
        planned ? 'asked' : 'not asked'
      )}
    </span>
  </li>
);

/** Where this app looks for one event: your read relays, discovery, and
 * the author's NIP-65 — each marked with whether the lookup plan would
 * have asked it and whether it actually served the event. */
export const RelayDebugRows = ({ id, author, foundOn }: {
  id: string;
  author?: string;
  foundOn?: readonly string[];
}) => {
  const { config } = useAppContext();
  const { myRead, plan } = useRouting();
  const authorList = useRelayList(author).list;
  const planned = new Set(
    plan({ kind: 'resolveById', id, author, hints: [...(foundOn ?? [])] })
      .tiers.flatMap((tier) => [...tier.groups.keys()]),
  );
  const found = new Set(foundOn ?? []);
  const groups: readonly [string, readonly string[]][] = [
    ['your read relays', myRead],
    ['discovery relays', config.discoveryRelays],
    [`author's relays${author ? '' : ' (unknown author)'}`, [...authorList.read, ...authorList.write]],
  ];
  return (
    <div className="space-y-5">
      {groups.map(([title, urls]) => (
        <div key={title}>
          <p className="text-muted-foreground mb-2 text-xs">{title}</p>
          {urls.length === 0 ? (
            <p className="text-muted-foreground/60 text-xs">none known</p>
          ) : (
            <ul className="overflow-hidden rounded-sm border border-border/70 divide-y divide-border/50">
              {[...new Set(urls)].map((url) => (
                <RelayRow key={url} url={url} found={found.has(url)} planned={planned.has(url)} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};

type EventInfoTab = 'event' | 'relays' | 'raw';

const TABS: readonly { id: EventInfoTab; label: string }[] = [
  { id: 'event', label: 'event' },
  { id: 'relays', label: 'relays' },
  { id: 'raw', label: 'raw' },
];

/** A relay URL parked inside a tag (NIP-10/e-tag hints) — routing
 * noise here: the relays tab owns routing, so the table drops it. */
const isRelayHint = (part: string): boolean => /^wss?:\/\//.test(part);

/** One tag row, on the same grid as the field rows above it — toned
 * name in the label column, values as chips, every field verbatim. The
 * one annotation: a NIP-13 nonce target — a bare `2` says nothing. */
const TagRow = ({ tag, author }: { tag: readonly string[]; author: string }) => {
  const [name, value] = tag;
  const href =
    name === 'p' && value ? profileHref(value)
    : name === 'e' && value ? eventHref(value, author)
    : undefined;
  const extras = tag.slice(2).filter((part) => !isRelayHint(part));
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={cn('w-16 shrink-0 pt-0.5 font-mono', toneClass(name))}>{name}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-start gap-1.5">
        {value !== undefined && (
          <CopyValue value={value}>
            {href ? (
              <Link to={href} className="min-w-0 break-all">
                <Chip className="text-xs leading-normal">{value}</Chip>
              </Link>
            ) : (
              <span className="min-w-0 break-all"><Chip className="text-xs leading-normal">{value}</Chip></span>
            )}
          </CopyValue>
        )}
        {extras.map((part, i) => (
          <CopyValue key={i} value={part}>
            <span className="min-w-0 break-all">
              <Chip dimmed className="text-xs leading-normal">
                {name === 'nonce' && i === 0 ? `target: ${part}` : part}
              </Chip>
            </span>
          </CopyValue>
        ))}
      </span>
    </div>
  );
};

/**
 * Event inspector, three tabs (the ConnectionsDialog row pattern):
 * `event` — the load-bearing fields parsed into links plus the tag
 * table; `relays` — where this app looked and what served the event;
 * `raw` — the JSON event. Private wrappers (1370/1470) add one toggle
 * per decoded layer — wrapper, seal, rumour — a layer that cannot open
 * with the keys at hand says so. The smooth shell holds one height
 * across tabs: switching never jolts the frame.
 */
export const EventInfoDialog = ({
  event,
  foundOn,
  replyCek,
  open,
  onOpenChange,
}: {
  event: NostrEvent;
  foundOn?: string[];
  /** The conversation's reply CEK — decodes 1470 replies. */
  replyCek?: Uint8Array;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const sk = useSessionKey();
  // Decoding only while open — this dialog mounts on every note, and
  // layer-opening is ECDH + AEAD per private wrapper.
  const layers = useMemo(
    () => (open && sk && isPrivateKind(event.kind) ? privateNoteLayers(sk, event, replyCek) : undefined),
    [open, sk, event, replyCek],
  );
  const authorHref = profileHref(event.pubkey);
  const [tab, setTab] = useState<EventInfoTab>('event');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SmoothDialogContent className="max-w-[95vw] sm:max-w-2xl" minHeight={460}>
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-sm font-semibold leading-none tracking-tight">
            event info
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b px-6 py-2">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'cursor-pointer rounded-sm px-2 py-1 text-xs transition-colors',
                tab === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'event' && (
          <div className="space-y-3 px-6 pb-6 pt-4">
            <div className="space-y-1">
              <Row label="id" copy={event.id}>
                {(() => {
                  const href = eventHref(event.id, event.pubkey);
                  return href ? (
                    <Link className="text-primary underline underline-offset-2" to={href}>
                      {event.id}
                    </Link>
                  ) : (
                    event.id
                  );
                })()}
              </Row>
              <Row label="author" copy={nip19.npubEncode(event.pubkey)}>
                {authorHref ? (
                  <Link className="text-primary underline underline-offset-2" to={authorHref}>
                    {nip19.npubEncode(event.pubkey)}
                  </Link>
                ) : (
                  event.pubkey
                )}
              </Row>
              <Row label="kind" copy={String(event.kind)}>{event.kind}</Row>
              <Row
                label="created"
                copy={new Date(event.created_at * 1000).toISOString()}
              >
                {new Date(event.created_at * 1000).toISOString()} ({event.created_at})
              </Row>
              <Row label="sig" copy={event.sig}>
                <span className="font-mono">{event.sig}</span>
              </Row>
              {foundOn && foundOn.length > 0 && (
                <Row label="found on">
                  <span className="flex flex-wrap items-center gap-1">
                    {foundOn.map((url) => (
                      <CopyValue key={url} value={url}>
                        <RelayPill url={url} className="text-xs" />
                      </CopyValue>
                    ))}
                  </span>
                </Row>
              )}
            </div>

            {layers && layers.length > 0 && (
              <div className="space-y-2">
                {layers.map((layer, i) => (
                  <Toggle key={layer.name} title={layerTitle(layer, i)}>
                    {typeof layer.decoded === 'string' ? (
                      <p className="text-muted-foreground text-xs">{layer.decoded}</p>
                    ) : (
                      <JsonBlock value={layer.decoded as NostrEvent} />
                    )}
                  </Toggle>
                ))}
              </div>
            )}

            {event.tags.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-2 text-xs">tags</p>
                <div className="space-y-1">
                  {event.tags.map((tag, i) => (
                    <TagRow key={i} tag={tag} author={event.pubkey} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'relays' && (
          <div className="px-6 pb-6 pt-4">
            <RelayDebugRows id={event.id} author={event.pubkey} foundOn={foundOn} />
          </div>
        )}

        {tab === 'raw' && (
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-4">
            <JsonBlock value={event} className="max-h-none min-h-0 flex-1" />
          </div>
        )}
      </SmoothDialogContent>
    </Dialog>
  );
};
