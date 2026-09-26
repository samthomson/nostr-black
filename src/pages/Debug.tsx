import { useEffect, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Shell } from '@/components/Shell';
import { egressLog, isTor, type EgressEntry } from '@/net/net';
import { useAppContext } from '@/hooks/useAppContext';
import { hostOf } from '@/lib/format';

/**
 * Debug page: what the app asked of the network — relay queries with the
 * filters sent and what came back, plus connection/socket history.
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

  const queries = entries.filter((e) => e.kind === 'query');

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
        <p className="font-medium">relay queries ({queries.length})</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pr-2">relay</th>
                <th className="pr-2">kinds</th>
                <th className="pr-2">authors</th>
                <th className="pr-2">events</th>
                <th className="pr-2">ms</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {queries.slice(0, 40).map((q, i) => (
                <tr key={`${q.ts}-${i}`} className="border-b">
                  <td className="py-1 pr-2 font-mono">{hostOf(q.url)}</td>
                  <td className="py-1 pr-2 font-mono">{q.kinds}</td>
                  <td className="py-1 pr-2 font-mono">{q.authors ?? '—'}</td>
                  <td className="py-1 pr-2 font-mono">{q.events ?? '…'}</td>
                  <td className="py-1 pr-2 font-mono">{q.ms ?? '…'}</td>
                  <td className={`py-1 font-mono ${q.status === 'empty' ? 'text-muted-foreground' : ''}`}>
                    {q.status ?? 'pending'}
                  </td>
                </tr>
              ))}
              {queries.length === 0 && (
                <tr><td className="text-muted-foreground">no queries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-medium">
          your relays{' '}
          <span className="text-muted-foreground text-xs">
            {config.relayMetadata.updatedAt > 0
              ? `(fetched ${new Date(config.relayMetadata.updatedAt * 1000).toLocaleString()})`
              : '(not fetched yet)'}
          </span>
        </p>
        <table className="w-full text-left text-xs">
          <tbody>
            {config.relayMetadata.relays.map((r) => (
              <tr key={r.url} className="border-b">
                <td className="text-muted-foreground w-8 py-1 font-mono">
                  {r.read ? 'r' : '·'}{r.write ? 'w' : '·'}
                </td>
                <td className="py-1 font-mono">{r.url}</td>
              </tr>
            ))}
            {config.relayMetadata.relays.length === 0 && (
              <tr><td className="text-muted-foreground">(not fetched yet)</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <p className="font-medium">discovery relays</p>
        <table className="w-full text-left text-xs">
          <tbody>
            {config.discoveryRelays.map((url) => (
              <tr key={url} className="border-b">
                <td className="py-1 font-mono">{url}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
