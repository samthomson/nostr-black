import { useEffect, useState } from 'react';
import { egressLog, isTor, type EgressEntry } from '@/net/net';
import { useAppContext } from '@/hooks/useAppContext';
import { hostOf } from '@/lib/format';

/**
 * Minimal debug panel. Dumb component: the page owns visibility, this just
 * renders what the app is doing on the network — tor status, configured
 * relays, queries sent and recent egress through the boundary (src/net).
 */
export const DebugPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { config } = useAppContext();
  const [entries, setEntries] = useState<EgressEntry[]>([]);
  const [tor, setTor] = useState<'unknown' | 'checking' | boolean>('unknown');

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setEntries([...egressLog]), 500);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  const checkTor = async () => {
    setTor('checking');
    try {
      setTor(await isTor());
    } catch {
      setTor('unknown');
    }
  };

  return (
    <div className="fixed bottom-2 left-2 z-50 max-h-[50vh] w-80 overflow-y-auto rounded-md border bg-popover p-3 text-xs leading-relaxed text-popover-foreground">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">debug</span>
        <button type="button" onClick={onClose} className="text-muted-foreground underline">
          close
        </button>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <span>
          tor:{' '}
          {tor === 'checking' ? '…' : tor === 'unknown' ? 'unknown' : String(tor)}
        </span>
        <button type="button" onClick={() => void checkTor()} className="underline">
          check
        </button>
      </div>

      <p className="mb-1 font-semibold">relays</p>
      <ul className="mb-2 space-y-0.5">
        {config.relayMetadata.relays.map((r) => (
          <li key={r.url} className="truncate">
            {r.read ? 'r' : '·'}
            {r.write ? 'w' : '·'} {r.url}
          </li>
        ))}
      </ul>

      <p className="mb-1 font-semibold">egress ({entries.length})</p>
      <ul className="space-y-0.5">
        {entries.slice(0, 30).map((e, i) => (
          <li key={`${e.ts}-${i}`} className="truncate">
            <span className="text-muted-foreground">{e.kind}</span>{' '}
            {e.kind === 'query' ? e.url : hostOf(e.url)}
          </li>
        ))}
        {entries.length === 0 && <li className="text-muted-foreground">nothing yet</li>}
      </ul>
    </div>
  );
};
