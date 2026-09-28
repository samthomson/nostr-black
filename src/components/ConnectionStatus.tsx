import { useEgress } from '@/hooks/useEgress';
import { useRoutePreference, useIsDesktop } from '@/hooks/useTransport';
import { useIsTor } from '@/hooks/useEgress';
import { hostOf } from '@/lib/format';

/** Bottom status bar: what the network layer is doing, in plain words.
 * Desktop adds the tor/clearnet route toggle. */
export const ConnectionStatus = () => {
  const desktop = useIsDesktop();
  const onTor = useIsTor();
  const { torEnabled, set } = useRoutePreference();
  const entries = useEgress();

  const queries = entries.filter((e) => e.kind === 'query');
  const relays = new Set(queries.map((e) => e.url));
  const events = queries.reduce((sum, e) => sum + (e.events ?? 0), 0);
  const pending = queries.filter((e) => e.events === undefined).length;
  const blocked = [
    ...new Set(
      queries
        .filter((e) => e.status === 'auth' || e.status === 'error')
        .map((e) => ({ host: hostOf(e.url), status: e.status!, reason: e.reason })),
    ),
  ];

  const stats = (
    <>
      <span>
        {relays.size} {relays.size === 1 ? 'relay' : 'relays'} · {events}{' '}
        {events === 1 ? 'event' : 'events'}
      </span>
      {pending > 0 && <span className="text-yellow-600">{pending} loading</span>}
      {blocked.length > 0 && (
        <span
          className="cursor-help text-red-500"
          title={blocked.map((b) => `${b.host}: ${b.status}${b.reason ? ` (${b.reason})` : ''}`).join('\n')}
        >
          {blocked.length} blocked
        </span>
      )}
    </>
  );

  if (!desktop) {
    return (
      <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 font-mono text-[11px] text-muted-foreground">
        <span className={onTor ? 'text-emerald-600' : 'text-amber-600'}>
          {onTor === undefined ? 'checking tor…' : onTor ? 'tor' : 'clearnet'}
        </span>
        <span className="ml-auto flex items-center gap-4">{stats}</span>
      </div>
    );
  }

  return (
    <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 font-mono text-[11px] text-muted-foreground">
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
