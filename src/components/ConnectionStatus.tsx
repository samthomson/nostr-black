import { useState } from 'react';
import { useEgress, useEgressSession, useIsTor } from '@/hooks/useEgress';
import { useRoutePreference, useIsDesktop } from '@/hooks/useTransport';
import { hostOf } from '@/lib/format';

/** Bottom status bar: what the network layer is doing, in plain words.
 * Desktop adds the tor/clearnet route toggle. */
export const ConnectionStatus = () => {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const desktop = useIsDesktop();
  const onTor = useIsTor();
  const { torEnabled, set } = useRoutePreference();
  const entries = useEgress();
  const session = useEgressSession();

  const queries = entries.filter((e) => e.kind === 'query');
  const pending = queries.filter((e) => e.events === undefined).length;
  const blockedByHost = new Map<string, { host: string; status: string; reason?: string }>();
  for (const e of queries) {
    if (e.status !== 'auth' && e.status !== 'error') continue;
    const host = hostOf(e.url);
    if (!blockedByHost.has(host)) {
      blockedByHost.set(host, { host, status: e.status, reason: e.reason });
    }
  }
  const blocked = [...blockedByHost.values()];

  const stats = (
    <>
      <span>
        {session.relays} {session.relays === 1 ? 'relay' : 'relays'} · {session.events}{' '}
        {session.events === 1 ? 'event' : 'events'}
      </span>
      {pending > 0 && <span className="text-yellow-600">{pending} loading</span>}
      {blocked.length > 0 && (
        <span className="relative">
          <button
            type="button"
            className="cursor-pointer text-red-500"
            onClick={() => setBlockedOpen((open) => !open)}
          >
            {blocked.length} blocked
          </button>
          {blockedOpen && (
            <ul className="absolute right-0 bottom-7 z-50 max-h-64 min-w-48 space-y-1 overflow-auto rounded-sm border bg-background p-2 font-mono text-[11px] text-foreground">
              {blocked.map((b) => (
                <li key={b.host}>
                  <span className="text-red-500">{b.host}</span>
                  {b.reason ? ` — ${b.reason}` : ` — ${b.status}`}
                </li>
              ))}
            </ul>
          )}
        </span>
      )}
    </>
  );

  if (!desktop) {
    return (
      <div className="relative flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 font-mono text-[11px] text-muted-foreground">
        <span className={onTor ? 'text-emerald-600' : 'text-amber-600'}>
          {onTor === undefined ? 'checking tor…' : onTor ? 'tor' : 'clearnet'}
        </span>
        <span className="ml-auto flex items-center gap-4">{stats}</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 font-mono text-[11px] text-muted-foreground">
      {/* Route toggle: the highlighted segment IS the active route. */}
      <div className="flex overflow-hidden rounded-sm border" role="group" aria-label="transport route">
        {([true, false] as const).map((tor) => (
          <button
            key={tor ? 'tor' : 'clearnet'}
            type="button"
            onClick={() => set(tor)}
            className={`px-2 py-0.5 leading-none transition-colors ${
              torEnabled === tor
                ? tor
                  ? 'bg-emerald-600 text-white'
                : 'bg-amber-600 text-white'
                : 'hover:bg-accent'
            }`}
          >
            {tor ? 'tor' : 'clearnet'}
          </button>
        ))}
      </div>
      <span className="ml-auto flex items-center gap-4">{stats}</span>
    </div>
  );
};
