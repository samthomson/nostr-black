import { useEffect, useState } from 'react';
import { egressLog, egressSession, isTor as probeTor, type EgressEntry } from '@/net/net';

export type { EgressEntry };

/** Survives TorGate remounts (feed ↔ profile). Cleared in tests. */
let lastTor: boolean | undefined;

/** Tests only. */
export const resetUseIsTor = (): void => {
  lastTor = undefined;
};

/** Result of the web Tor probe (desktop is tor-by-construction: true). */
export function useIsTor(): boolean | undefined {
  const [onTor, setOnTor] = useState<boolean | undefined>(lastTor);
  useEffect(() => {
    let cancelled = false;
    void probeTor().then((result) => {
      lastTor = result;
      if (!cancelled) setOnTor(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return onTor;
}

/** Live snapshot of the egress ring buffer, polled. Debug/status surfaces. */
export function useEgress(intervalMs = 500): EgressEntry[] {
  const [entries, setEntries] = useState<EgressEntry[]>(() => [...egressLog]);
  useEffect(() => {
    const timer = setInterval(() => setEntries([...egressLog]), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return entries;
}

/** Session totals that only increase — the status bar, not the ring buffer. */
export const useEgressSession = (intervalMs = 500): { relays: number; events: number } => {
  const [session, setSession] = useState(egressSession);
  useEffect(() => {
    const timer = setInterval(() => setSession(egressSession()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return session;
};
