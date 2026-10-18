import { useState } from 'react';
import { getPublicKey } from 'nostr-tools';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useRouting } from '@/data/hooks/useRouting';
import { useConnections } from '@/data/hooks/useConnections';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { requestConnection, type ConnectionRecord } from '@/lib/feedEncryption';
import { npubOf } from '@/lib/format';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Connection request for one pubkey — the button on profile surfaces
 * (hover card, profile page). Sends a kind 30378 request through the
 * standard broadcast modal; once the request is in the graph the button
 * disappears — the connection lives on the connections page. Not signed
 * in with a session key (extension login) — the button is absent, the
 * card never advertises a dead control. Already connected or requested
 * — likewise absent.
 */
export const ConnectButton = ({ pubkey, compact = false }: {
  pubkey: string;
  /** Hover-card footer sizing. */
  compact?: boolean;
}) => {
  const sk = useSessionKey();
  const { request, dialog } = useBroadcastFlow();
  const { myWrite } = useRouting();
  const { records } = useConnections();
  const [busy, setBusy] = useState(false);

  if (!sk) return null;
  if (pubkey === getPublicKey(sk)) return null;
  const existing: ConnectionRecord | undefined = records.find((r) => r.peer === pubkey);
  if (existing && (existing.state === 'connected' || existing.state === 'request')) return null;

  const send = () => {
    setBusy(true);
    try {
      const event = requestConnection(sk, pubkey);
      request({
        grade: 'private',
        label: 'connection request',
        content: `connect with ${npubOf(pubkey).slice(0, 20)}… — one signature, awaiting theirs`,
        identityPubkey: getPublicKey(sk),
        identityNote: 'connection key',
        relays: myWrite,
        extraRelays: DEFAULT_DISCOVERY_RELAYS.filter((url) => !myWrite.includes(url)),
        events: [event],
      });
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      <Button
        variant="privacy"
        size={compact ? 'xs' : 'sm'}
        disabled={busy}
        className={cn(!compact && PRIVACY_BUTTON, PRIVACY.private.className)}
        onClick={send}
      >
        connect
      </Button>
      {dialog}
    </>
  );
};
