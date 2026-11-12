import { useMemo, useState } from 'react';
import { nip19 } from 'nostr-tools';
import { Check, ChevronDown } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { profileHref, eventHref, shortHex } from '@/lib/format';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { isPrivateKind, privateNoteLayers, type EventLayer } from '@/lib/feedEncryption';
import { useRouting } from '@/data/hooks/useRouting';
import { useAppContext } from '@/hooks/useAppContext';
import { useRelayList } from '@/data/hooks/useProfile';

/** One row of a parsed field, when it applies. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-sm">
    <span className="text-muted-foreground w-20 shrink-0">{label}</span>
    <span className="min-w-0 break-all">{children}</span>
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
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm"
      >
        <span>{title}</span>
        <ChevronDown className={cn('text-muted-foreground size-4 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && <div className="border-t px-3 py-3">{children}</div>}
    </div>
  );
};

/** Formatted JSON — 4-space indent, the house style. Exported for the
 *  broadcast queue viewer, which previews its own events. */
export const JsonBlock = ({ value }: { value: NostrEvent | RumorJson }) => (
  <pre className="max-h-64 overflow-auto rounded-sm bg-muted p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
    {JSON.stringify(value, null, 4)}
  </pre>
);

export type RumorJson = { kind: number; [key: string]: unknown };

const layerTitle = (layer: EventLayer, i: number): string => {
  const kind = typeof layer.decoded === 'object' && layer.decoded !== null && 'kind' in layer.decoded
    ? ` (kind ${String(layer.decoded.kind)})`
    : '';
  return `layer ${i + 1} · ${layer.name}${kind}`;
};
/** One relay row with its lookup status: found on (accented, checked),
 * in the lookup plan (would have been asked), or present but never
 * asked. */
const RelayRow = ({ url, found, planned }: { url: string; found: boolean; planned: boolean }) => (
  <li
    className={cn(
      'flex items-center gap-2 text-sm',
      found ? 'text-copper font-medium' : planned ? 'text-foreground/70' : 'text-muted-foreground/60',
    )}
  >
    {found ? (
      <Check aria-hidden="true" className="size-3.5 shrink-0" />
    ) : (
      <span aria-hidden="true">{planned ? '○' : '·'}</span>
    )}
    <span className="min-w-0 flex-1 break-all font-mono text-xs">{url}</span>
    <span className={cn('shrink-0 text-xs', !found && 'text-muted-foreground')}>
      {found ? 'found here' : planned ? 'asked' : 'not asked'}
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
    <div className="space-y-3">
      {groups.map(([title, urls]) => (
        <div key={title}>
          <p className="text-muted-foreground text-xs">{title}</p>
          {urls.length === 0 ? (
            <p className="text-muted-foreground/60 text-xs">none known</p>
          ) : (
            <ul className="space-y-1">
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
/**
 * Event inspector, three tabs (the ConnectionsDialog row pattern):
 * `event` — the load-bearing fields parsed into links (author, id, tag
 * references), plus private layers and tags; `relays` — where this app
 * looked and what served the event; `raw` — the JSON event. For a
 * private wrapper (1370/1470) one toggle per decoded layer — wrapper,
 * seal, rumour — each as formatted JSON; a layer that cannot open with
 * the keys at hand says so.
 */
type EventInfoTab = 'event' | 'relays' | 'raw';

const TABS: readonly { id: EventInfoTab; label: string }[] = [
  { id: 'event', label: 'event' },
  { id: 'relays', label: 'relays' },
  { id: 'raw', label: 'raw' },
];

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
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[85dvh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight">
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
              <Row label="id">
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
              <Row label="author">
                {authorHref ? (
                  <Link className="text-primary underline underline-offset-2" to={authorHref}>
                    {nip19.npubEncode(event.pubkey)}
                  </Link>
                ) : (
                  event.pubkey
                )}
              </Row>
              <Row label="kind">{event.kind}</Row>
              <Row label="created">
                {new Date(event.created_at * 1000).toISOString()} ({event.created_at})
              </Row>
              <Row label="sig">
                <span className="font-mono text-xs">{shortHex(event.sig)}</span>
              </Row>
              {foundOn && foundOn.length > 0 && (
                <Row label="found on"><span className="text-copper font-medium">{foundOn.join(', ')}</span></Row>
              )}
            </div>

            {layers && layers.length > 0 && (
              <div className="space-y-2">
                {layers.map((layer, i) => (
                  <Toggle key={layer.name} title={layerTitle(layer, i)}>
                    {typeof layer.decoded === 'string' ? (
                      <p className="text-muted-foreground text-sm">{layer.decoded}</p>
                    ) : (
                      <JsonBlock value={layer.decoded as NostrEvent} />
                    )}
                  </Toggle>
                ))}
              </div>
            )}

            {event.tags.length > 0 && (
              <Toggle title="tags">
                <ul className="space-y-1 text-sm">
                  {event.tags.map((tag, i) => {
                    const [name, value] = tag;
                    const href =
                      name === 'p' && value ? profileHref(value)
                      : name === 'e' && value ? eventHref(value, event.pubkey)
                      : undefined;
                    return (
                      <li key={i} className="min-w-0">
                        <span className="text-muted-foreground">[{name}] </span>
                        {href ? (
                          <Link className="text-primary break-all underline underline-offset-2" to={href}>
                            {value}
                          </Link>
                        ) : (
                          <span className="break-all">{value ?? ''}</span>
                        )}
                        {tag.slice(2).length > 0 && (
                          <span className="text-muted-foreground break-all text-xs"> {tag.slice(2).join(', ')}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Toggle>
            )}
          </div>
        )}

        {tab === 'relays' && (
          <div className="px-6 pb-6 pt-4">
            <RelayDebugRows id={event.id} author={event.pubkey} foundOn={foundOn} />
          </div>
        )}

        {tab === 'raw' && (
          <div className="px-6 pb-6 pt-4">
            <JsonBlock value={event} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
