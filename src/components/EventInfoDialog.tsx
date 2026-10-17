import { useState } from 'react';
import { nip19 } from 'nostr-tools';
import { ChevronDown } from 'lucide-react';
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

/** Formatted JSON — 4-space indent, the house style. */
const JsonBlock = ({ value }: { value: NostrEvent | RumorJson }) => (
  <pre className="max-h-64 overflow-auto rounded-sm bg-muted p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
    {JSON.stringify(value, null, 4)}
  </pre>
);

type RumorJson = { kind: number; [key: string]: unknown };

const layerTitle = (layer: EventLayer, i: number): string => {
  const kind = typeof layer.decoded === 'object' && layer.decoded !== null && 'kind' in layer.decoded
    ? ` (kind ${String(layer.decoded.kind)})`
    : '';
  return `layer ${i + 1} · ${layer.name}${kind}`;
};

/**
 * Event inspector. The load-bearing parts parsed into links (author,
 * id, tag references), everything else in labelled toggles: for a
 * private wrapper (1370/1470) one toggle per decoded layer — wrapper,
 * seal, rumour — each as formatted JSON; then the tags and the raw
 * event. A layer that cannot open with the keys at hand says so.
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
  const authorHref = profileHref(event.pubkey);
  const sk = useSessionKey();
  const layers = sk && isPrivateKind(event.kind) ? privateNoteLayers(sk, event, replyCek) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[85dvh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight">
            event info
          </DialogTitle>
        </DialogHeader>

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
              <Row label="found on">{foundOn.join(', ')}</Row>
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

          <Toggle title="raw event">
            <JsonBlock value={event} />
          </Toggle>
        </div>
      </DialogContent>
    </Dialog>
  );
};
