import { useSeoMeta } from '@unhead/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { useEgress, useIsTor } from '@/hooks/useEgress';
import type { EgressEntry } from '@/hooks/useEgress';
import { useMediaCache } from '@/hooks/useMediaCache';
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

type RelayHealth = 'error' | 'auth' | 'empty' | 'ok';

/** Worst recent health of a relay: error > auth > everything-empty > ok. */
const relayHealth = (g: RelayGroup): RelayHealth => {
  if (g.queries.some((q) => q.status === 'error')) return 'error';
  if (g.queries.some((q) => q.status === 'auth')) return 'auth';
  if (g.queries.length > 0 && g.queries.every((q) => (q.events ?? 0) === 0)) return 'empty';
  return 'ok';
};

const HEALTH_STYLE: Record<RelayHealth, string> = {
  error: 'text-red-500',
  auth: 'text-amber-500',
  empty: 'text-yellow-700',
  ok: 'text-emerald-600',
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
  // Unhealthy relays first (worst health, then most queries); healthy after.
  const order: Record<RelayHealth, number> = { error: 0, auth: 1, empty: 2, ok: 3 };
  return [...groups.values()].sort(
    (a, b) =>
      order[relayHealth(a)] - order[relayHealth(b)] ||
      b.queries.length - a.queries.length ||
      a.host.localeCompare(b.host),
  );
};

/** Tree node for the data section: domain → queries → data summaries. */
interface DataNode {
  label: string;
  count?: string;
  children?: DataNode[];
}

/** Short, human label for a key segment: hex/bech32 ids become #abc123. */
const leafLabel = (raw: string): string =>
  raw.length > 16 && /^[a-z0-9]+$/i.test(raw) ? `#${raw.slice(0, 6)}` : raw;

const dataTree = (entries: { queryKey: readonly unknown[]; state: { status: string; data: unknown } }[]): DataNode[] => {
  const domains = new Map<string, { label: string; count: number; byName: Map<string, number> }>();
  for (const q of entries) {
    const key = q.queryKey.map((k) => (typeof k === 'string' ? k : '')).filter(Boolean);
    const domain = key[0] === 'outbox' ? 'feed pipeline' : key[0] === 'profile' ? 'profiles' : key[0] === 'nostr' ? 'accounts' : (key[0] ?? 'other');
    const leaf = leafLabel(
      key[0] === 'outbox' || key[0] === 'profile' || key[0] === 'nostr' ? (key[1] ?? key[0]) : (key[1] ?? '…'),
    );
    const d = domains.get(domain) ?? { label: domain, count: 0, byName: new Map() };
    const data = q.state.data;
    const n = Array.isArray(data)
      ? data.length
      : data && typeof data === 'object' && 'notes' in (data as Record<string, unknown>)
        ? (data as { notes: unknown[] }).notes.length
        : data === undefined
          ? 0
          : 1;
    d.count += n;
    d.byName.set(leaf, (d.byName.get(leaf) ?? 0) + n);
    domains.set(domain, d);
  }
  return [...domains.values()].map((d) => ({
    label: d.label,
    count: `${d.count} items`,
    children: [...d.byName.entries()].map(([label, n]) => ({ label, count: String(n) })),
  }));
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
  const { state: userState } = useUserState();
  const entries = useEgress();
  const onTor = useIsTor();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache().getAll();
  const media = useMediaCache();

  const relayGroups = groupByRelay(entries);
  const unhealthy = relayGroups.filter((g) => relayHealth(g) !== 'ok' && relayHealth(g) !== 'empty');
  const empty = relayGroups.filter((g) => relayHealth(g) === 'empty');
  const healthy = relayGroups.length - unhealthy.length - empty.length;

  return (
    <div className="space-y-6 text-sm">
      {/* Health summary: the answer to "is anything wrong?" at a glance. */}
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded-sm border px-2 py-1">
          tor: {onTor === undefined ? '…' : String(onTor)}
        </span>
        <span className={`${healthy > 0 ? HEALTH_STYLE.ok : ''} rounded-sm border px-2 py-1`}>
          {healthy} relays serving
        </span>
        {empty.length > 0 && (
          <span className={`${HEALTH_STYLE.empty} rounded-sm border px-2 py-1`}>
            {empty.length} returning nothing
          </span>
        )}
        {unhealthy.length > 0 && (
          <span className={`${HEALTH_STYLE.error} rounded-sm border px-2 py-1`}>
            {unhealthy.length} failing: {unhealthy.map((g) => g.host).join(', ')}
          </span>
        )}
        <span className="rounded-sm border px-2 py-1">
          media cache {(media.bytes / 1024 / 1024).toFixed(1)} MB
        </span>
      </div>

      <div className="space-y-2">
        <p className="font-medium">
          relays — problems first{' '}
          <span className="text-muted-foreground text-xs font-normal">
            problems first — ○ empty is often normal (niche relays hold
            nothing for your follows); ✕ and ▲ are real refusals
          </span>
        </p>
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
              {relayGroups.map((g) => {
                const health = relayHealth(g);
                const reason = g.queries.find((q) => q.reason)?.reason;
                return (
                  <tr key={g.host} className="border-b align-top">
                    <td className="py-2 pr-2 font-mono">
                      <span className={HEALTH_STYLE[health]}>
                        {health === 'error' ? '✕ ' : health === 'auth' ? '▲ ' : health === 'empty' ? '○ ' : '✓ '}
                      </span>
                      {g.host}
                      {reason && (
                        <span className="text-muted-foreground block text-[10px]" title={reason}>
                          {reason.slice(0, 60)}
                        </span>
                      )}
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
                              <td className={`pr-2 font-mono ${q.status === 'empty' ? '' : HEALTH_STYLE[health]}`}>
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
                );
              })}
              {relayGroups.length === 0 && (
                <tr><td className="text-muted-foreground">no queries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-medium">
          data held locally{' '}
          <span className="text-muted-foreground text-xs font-normal">
            what the app has fetched this session, grouped by domain
          </span>
        </p>
        <ul className="space-y-1 font-mono text-xs">
          {dataTree(cache).map((node) => (
            <li key={node.label}>
              <details>
                <summary className="cursor-pointer">
                  {node.label} — {node.count}
                </summary>
                <ul className="text-muted-foreground ml-4">
                  {node.children?.map((c) => (
                    <li key={c.label}>
                      {c.label}: {c.count}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
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
        <p className="font-medium">your relays (NIP-65)</p>
        <table className="w-full text-left text-xs">
          <tbody>
            {userState.relayMetadata.relays.map((r) => (
              <tr key={r.url} className="border-b">
                <td className="py-1 font-mono">
                  {r.read ? 'r' : '·'}
                  {r.write ? 'w' : '·'} {r.url}
                </td>
              </tr>
            ))}
            {userState.relayMetadata.relays.length === 0 && (
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
