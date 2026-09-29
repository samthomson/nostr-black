import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { profileHref, eventHref, shortHex } from '@/lib/format';
import { Link } from 'react-router-dom';

/** One row of a parsed field, when it applies. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-sm">
    <span className="text-muted-foreground w-20 shrink-0">{label}</span>
    <span className="min-w-0 break-all">{children}</span>
  </div>
);

/**
 * Event inspector: the raw JSON plus the load-bearing parts parsed into
 * links (author profile, event id, referenced events/profiles from tags).
 */
export const EventInfoDialog = ({
  event,
  foundOn,
  open,
  onOpenChange,
}: {
  event: NostrEvent;
  foundOn?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const authorHref = profileHref(event.pubkey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[85dvh] overflow-y-auto p-0 gap-0 rounded-2xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight">
            event info
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-6 pt-4">
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

          {event.tags.length > 0 && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-sm">tags</p>
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
            </div>
          )}

          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">raw</p>
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 text-xs leading-relaxed break-all whitespace-pre-wrap">
              {JSON.stringify(event, null, 4)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
