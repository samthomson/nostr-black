import { useEffect, useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Shell } from '@/components/Shell';
import { egressLog, isTor, type EgressEntry } from '@/net/net';
import { useAppContext } from '@/hooks/useAppContext';
import { hostOf } from '@/lib/format';

/** Per-relay view: all queries to one relay grouped into one row. */
interface RelayGroup {
  host: string;
  url: string;
  queries: EgressEntry[];
  totalEvents: number;
  avgMs: number;
  maxMs: number;
}

const groupByRelay = (entries: EgressEntry[]): RelayGroup[] => {
  const groups = new Map<string, RelayGroup>();
  for (const e of entries) {
    if (e.kind !== 'query') continue;
    const host = hostOf(e.url);
    const group =
      groups.get(host) ?? { host, url: e.url, queries: [], totalEvents: 0, avgMs: 0, maxMs: 0 };
    group.queries.push(e);
    group.totalEvents += e.events ?? 0;
    const times = group.queries
      .map((q) => q.ms)
      .filter((ms): ms is number => ms !== undefined);
    group.avgMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    group.maxMs = times.length > 0 ? Math.max(...times) : 0;
    groups.set(host, group);
  }
  // Most-queried relay first; stable within.
  return [...groups.values()].sort(
    (a, b) => b.queries.length - a.queries.length || a.host.localeCompare(b.host),
  );
};

/**
 * Debug page: what the app asked of the network, grouped by relay — one row
 * per relay, that relay's queries (kinds, authors, results, timing) within.
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

  const relayGroups = groupByRelay(entries);

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
        <p className="font-medium">relay queries ({entries.filter((e) => e.kind === 'query').length} to {relayGroups.length} relays)</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pr-2">relay</th>
                <th className="pr-2">queries</th>
                <th className="pr-2">events</th>
                <th className="pr-2">avg ms</th>
                <th className="pr-2">max ms</th>
              </tr>
            </thead>
            <tbody>
              {relayGroups.map((g) => (
                <tr key={g.host} className="border-b align-top">
                  <td className="py-2 pr-2 font-mono">{g.host}</td>
                  <td className="py-2 pr-2">
                    <table>
                      <tbody>
                        {g.queries.slice(0, 8).map((q, i) => (
                          <tr key={`${q.ts}-${i}`} className="text-muted-foreground">
                            <td className="pr-2 font-mono">{q.kinds}</td>
                            <td className="pr-2 font-mono">a:{q.authors ?? '—'}</td>
                            <td className="pr-2 font-mono">{q.events ?? '…'} ev</td>
                            <td className="pr-2 font-mono">{q.ms ?? '…'} ms</td>
                            <td className={`font-mono ${q.status === 'empty' ? '' : 'text-foreground'}`}>
                              {q.status ?? 'pending'}
                            </td>
                          </tr>
                        ))}
                        {g.queries.length > 8 && (
                          <tr><td className="text-muted-foreground">+{g.queries.length - 8} more…</td></tr>
                        )}
                      </tbody>
                    </table>
                  </td>
                  <td className="py-2 pr-2 font-mono">{g.totalEvents}</td>
                  <td className="py-2 pr-2 font-mono">{g.avgMs}</td>
                  <td className="py-2 pr-2 font-mono">{g.maxMs}</td>
                </tr>
              ))}
              {relayGroups.length === 0 && (
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
