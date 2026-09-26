import { useEffect, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Shell } from '@/components/Shell';
import { egressLog, isTor, type EgressEntry } from '@/net/net';
import { useAppContext } from '@/hooks/useAppContext';
import { hostOf } from '@/lib/format';

/**
 * Debug page: what the app is doing on the network — tor status, configured
 * relays, queries sent and recent egress through the boundary (src/net).
 */
const DebugBody = () => {
  const { config } = useAppContext();
  const [entries, setEntries] = useState<EgressEntry[]>([]);
  const [tor, setTor] = useState<'unknown' | 'checking' | boolean>('unknown');

  useEffect(() => {
    const timer = setInterval(() => setEntries([...egressLog]), 500);
    return () => clearInterval(timer);
  }, []);

  const checkTor = async () => {
    setTor('checking');
    try {
      setTor(await isTor());
    } catch {
      setTor('unknown');
    }
  };

  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center gap-2">
        <span>
          tor:{' '}
          {tor === 'checking' ? '…' : tor === 'unknown' ? 'unknown' : String(tor)}
        </span>
        <button type="button" onClick={() => void checkTor()} className="underline">
          check
        </button>
      </div>

      <div className="space-y-2">
        <p className="font-medium">your relays</p>
        <ul className="space-y-1">
          {config.relayMetadata.relays.map((r) => (
            <li key={r.url} className="truncate">
              {r.read ? 'r' : '·'}
              {r.write ? 'w' : '·'} {r.url}
            </li>
          ))}
          {config.relayMetadata.relays.length === 0 && (
            <li className="text-muted-foreground">(not fetched yet)</li>
          )}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">discovery relays</p>
        <ul className="space-y-1">
          {config.discoveryRelays.map((url) => (
            <li key={url} className="truncate">{url}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">egress ({entries.length})</p>
        <ul className="space-y-1">
          {entries.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="truncate">
              <span className="text-muted-foreground">{e.kind}</span>{' '}
              {e.kind === 'query' ? e.url : hostOf(e.url)}
            </li>
          ))}
          {entries.length === 0 && <li className="text-muted-foreground">nothing yet</li>}
        </ul>
      </div>
    </div>
  );
};

const DebugPage = () => {
  useSeoMeta({ title: 'debug — nostr.black' });

  return (
    <Shell>
      <DebugBody />
    </Shell>
  );
};

export default DebugPage;
