import { useEgress } from '@/hooks/useEgress';
import { useRoutePreference, useIsDesktop } from '@/hooks/useTransport';
import { useIsTor } from '@/hooks/useEgress';

/**
 * Bottom status bar (desktop only): invoke bridge health, transport route
 * toggle, and live relay-query counters from the egress log. Classic desktop
 * app chrome — fixed at the base of the window so the transport is always
 * observable without opening the debug page.
 */
export const ConnectionStatus = () => {
  const desktop = useIsDesktop();
  const onTor = useIsTor();
  const { torEnabled, set } = useRoutePreference();
  const entries = useEgress();

  const queries = entries.filter((e) => e.kind === 'query');
  const pending = queries.filter((e) => e.events === undefined).length;
  const events = queries.reduce((sum, e) => sum + (e.events ?? 0), 0);
  const failing = [...new Set(
    queries.filter((e) => e.status === 'error' || e.status === 'auth').map((e) => e.url),
  )];

  if (!desktop) {
    // Web: no route toggle (the gate covers it), but the same live counters.
    return (
      <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 font-mono text-[11px] text-muted-foreground">
        <span className={onTor ? 'text-emerald-600' : 'text-amber-600'}>
          tor: {onTor === undefined ? '…' : onTor ? 'yes' : 'no'}
        </span>
        <span className="ml-auto">{events} ev</span>
        {pending > 0 && <span className="text-yellow-600">{pending} pending</span>}
        {failing.length > 0 && (
          <span className="truncate text-red-500" title={failing.join(' ')}>
            {failing.length} relay{failing.length > 1 ? 's' : ''} failing
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-7 shrink-0 items-center gap-4 border-t bg-background px-3 font-mono text-[11px] text-muted-foreground">
      {/* Segmented route toggle: the highlighted segment IS the active route. */}
      <div className="flex overflow-hidden rounded-sm border" role="group" aria-label="transport route">
        {([true, false] as const).map((tor) => (
          <button
            key={tor ? 'tor' : 'direct'}
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
            {tor ? 'tor' : 'direct'}
          </button>
        ))}
      </div>

      <span className="ml-auto">{events} ev</span>
      {pending > 0 && <span className="text-yellow-600">{pending} pending</span>}
      {failing.length > 0 && (
        <span className="truncate text-red-500" title={failing.join(' ')}>
          {failing.length} relay{failing.length > 1 ? 's' : ''} failing
        </span>
      )}
    </div>
  );
};
