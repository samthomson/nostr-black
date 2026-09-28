import { useSeoMeta } from '@unhead/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useAppContext } from '@/hooks/useAppContext';
import { useEgress, useIsTor } from '@/hooks/useEgress';
import type { EgressEntry } from '@/hooks/useEgress';
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

/** Worst recent health of a relay: auth-required beats nothing, errors win. */
const relayHealth = (g: RelayGroup): 'auth' | 'error' | undefined => {
  if (g.queries.some((q) => q.status === 'error')) return 'error';
  if (g.queries.some((q) => q.status === 'auth')) return 'auth';
  return undefined;
};

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
/** Human label for a query cache key (["outbox","feed",…] → 'feed'). */
const keyLabel = (key: readonly unknown[]): string => {
  const parts = key.map((k) => (typeof k === 'string' ? k : '…')).filter((k) => k !== '');
  if (parts[0] === 'outbox') return parts[1] ?? 'outbox';
  if (parts[0] === 'nostr') return parts[1] ?? 'nostr';
  return parts[0] ?? key.join(',');
};

const runTestQuery = async () => {
  const result = document.getElementById('test-query-result')!;
  const url = (document.getElementById('test-relay-url') as HTMLInputElement).value;
  result.textContent = 'querying…';
  const { queryRelay, egressLog } = await import('@/net/net');
  const events = await queryRelay(url, [{ kinds: [1], limit: 5 }], { timeoutMs: 15000 });
  const entry = egressLog.find((e) => e.kind === 'query');
  result.textContent = `${events.length} events · status=${entry?.status ?? '?'} reason=${entry?.reason ?? '—'}`;
};

const DebugBody = () => {
  const { config } = useAppContext();
  const entries = useEgress();
  const onTor = useIsTor();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache().getAll();

  const relayGroups = groupByRelay(entries);
  const tor = onTor;

  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center gap-2">
        <span>tor: {tor === undefined ? '…' : String(tor)}</span>
      </div>
      <div className="space-y-2">
        <p className="font-medium">
          test query{' '}
          <span className="text-muted-foreground font-normal text-xs">
            sends REQ kinds:[1] limit:5 to the url below
          </span>
        </p>
        <div className="flex gap-2">
          <input
            id="test-relay-url"
            defaultValue="wss://relay.samt.st/"
            className="flex-1 rounded-md border bg-transparent px-2 py-1 font-mono text-xs"
          />
          <button
            type="button"
            id="test-query-run"
            className="rounded-full border px-3 py-1 text-xs font-medium hover:bg-accent"
            onClick={() => void runTestQuery()}
          >
            run
          </button>
        </div>
        <p id="test-query-result" className="font-mono text-xs">—</p>
      </div>

      <div>
        <Link to="/crash" className="text-muted-foreground text-sm underline underline-offset-4">
          crash test page →
        </Link>
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
                  <td className="py-2 pr-2 font-mono">
                    {relayHealth(g) === 'auth' && <span className="mr-1 text-amber-500">▲</span>}
                    {relayHealth(g) === 'error' && <span className="mr-1 text-red-500">✕</span>}
                    {g.host}
                  </td>
                  <td className="py-2 pr-2">
                    <table>
                      <tbody>
                        {g.queries.slice(0, 8).map((q, i) => (
                          <tr key={`${q.ts}-${i}`} className="text-muted-foreground">
                            <td className="pr-2 font-mono">{q.kinds}</td>
                            <td className="pr-2 font-mono">a:{q.authors ?? '—'}</td>
                            <td className="pr-2 font-mono">{q.events ?? '…'} ev</td>
                            <td className="pr-2 font-mono">{q.ms ?? '…'} ms</td>
                            <td
                              className={`pr-2 font-mono ${
                                q.status === 'auth'
                                  ? 'text-amber-500'
                                  : q.status === 'error'
                                    ? 'text-red-500'
                                    : q.status === 'empty'
                                      ? 'text-yellow-700'
                                      : 'text-foreground'
                              }`}
                              title={q.reason}
                            >
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

      <div className="space-y-2">
        <p className="font-medium">local query cache ({cache.length} entries)</p>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="pr-2">query</th>
              <th className="pr-2">status</th>
              <th className="pr-2">data</th>
              <th className="pr-2">updated</th>
            </tr>
          </thead>
          <tbody>
            {cache.map((q) => {
              const data = q.state.data as unknown;
              const count = Array.isArray(data)
                ? `${data.length} items`
                : data && typeof data === 'object' && 'notes' in (data as Record<string, unknown>)
                  ? `${(data as { notes: unknown[] }).notes.length} notes`
                  : data === undefined
                    ? '—'
                    : 'object';
              return (
                <tr key={q.queryHash} className="border-b">
                  <td className="py-1 pr-2 font-mono">{keyLabel(q.queryKey)}</td>
                  <td className="py-1 pr-2 font-mono">{q.state.status}</td>
                  <td className="py-1 pr-2 font-mono">{count}</td>
                  <td className="py-1 pr-2 font-mono">
                    {q.state.dataUpdatedAt > 0
                      ? new Date(q.state.dataUpdatedAt).toLocaleTimeString()
                      : '—'}
                  </td>
                </tr>
              );
            })}
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
