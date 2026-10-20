import { useState } from 'react';
import { getPublicKey } from 'nostr-tools';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useRouting } from '@/data/hooks/useRouting';
import { useConnections } from '@/data/hooks/useConnections';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { requestConnection, acceptConnection, type ConnectionRecord } from '@/lib/feedEncryption';
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
  // An incoming request — they signed, I didn't — means this button should
  // accept their connection, not mint a competing one. A pair has exactly
  // one kind 30378 `d` (connAddrOf is ECDH-symmetric), so accepting writes
  // the same replaceable event with my signature added.
  const incoming = existing?.state === 'request'
    && !existing.payload.sigs.some((s) => s.pk === getPublicKey(sk));
  if (existing && !incoming) return null;

  const send = () => {
    setBusy(true);
    try {
      const event = incoming
        ? acceptConnection(sk, existing!)
        : requestConnection(sk, pubkey);
      request({
        grade: 'private',
        label: incoming ? 'connection accept' : 'connection request',
        content: incoming
          ? `accept ${npubOf(pubkey).slice(0, 20)}… — two signatures, connected`
          : `connect with ${npubOf(pubkey).slice(0, 20)}… — one signature, awaiting theirs`,
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
        {incoming ? 'accept' : 'connect'}
      </Button>
      {dialog}
    </>
  );
};
