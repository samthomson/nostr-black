import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Loader2 } from 'lucide-react';
import { getPublicKey } from 'nostr-tools';
import { Page } from '@/components/Page';
import { PrivacyTag } from '@/components/PrivacyTag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useRouting } from '@/data/hooks/useRouting';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useConnections } from '@/data/hooks/useConnections';
import { useProfile } from '@/data/hooks/useProfile';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import {
  acceptConnection,
  closeConnection,
  requestConnection,
  type ConnectionRecord,
} from '@/lib/feedEncryption';
import { parsePubkey, npubOf, profileHref } from '@/lib/format';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

const Peer = ({ pubkey }: { pubkey: string }) => {
  const { metadata, pending } = useProfile(pubkey);
  const name = metadata?.display_name || metadata?.name || `${npubOf(pubkey).slice(0, 10)}…`;
  const href = profileHref(pubkey);
  const label = pending ? '…' : name;
  if (!href) return <span className="font-semibold">{label}</span>;
  return (
    <Link to={href} className="font-semibold hover:underline">
      {label}
    </Link>
  );
};

const Row = ({
  record,
  action,
}: {
  record: ConnectionRecord;
  action?: { label: string; onClick: () => void; busy?: boolean };
}) => (
  <li className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
    <div className="min-w-0">
      <Peer pubkey={record.peer} />
      <p className="text-muted-foreground truncate font-mono text-xs">{npubOf(record.peer)}</p>
    </div>
    {action && (
      <Button
        type="button"
        variant="privacy"
        disabled={action.busy ?? false}
        onClick={action.onClick}
        className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
      >
        {action.busy ? <Loader2 className="size-3.5 animate-spin" /> : action.label}
      </Button>
    )}
  </li>
);

const ConnectionsBody = () => {
  const sk = useSessionKey();
  const { request: requestBroadcast, dialog } = useBroadcastFlow();
  const { myWrite } = useRouting();
  const discoveryTargets = DEFAULT_DISCOVERY_RELAYS.filter((url) => !myWrite.includes(url));
  const [input, setInput] = useState('');
  const [formError, setFormError] = useState<string | undefined>();
  const [lookup, setLookup] = useState<string | undefined>();
  const { records, connected, outgoing, incoming, pending } = useConnections(lookup);

  // The router's gate guarantees a user here.
  if (!sk) {
    return (
      <p className="text-muted-foreground text-sm">
        session key required — nsec login only. an extension cannot derive aliases or open envelopes.
      </p>
    );
  }

  const me = getPublicKey(sk);

  const peerOf = (): string | undefined => {
    const peer = parsePubkey(input);
    if (!peer) {
      setFormError('need an npub');
      return undefined;
    }
    if (peer === me) {
      setFormError('cannot connect to yourself');
      return undefined;
    }
    setFormError(undefined);
    return peer;
  };

  const lookUp = () => {
    const peer = peerOf();
    if (peer) setLookup(peer);
  };

  const request = () => {
    const peer = peerOf();
    if (!peer) return;
    const existing = records.find((r) => r.peer === peer);
    if (existing?.state === 'connected') {
      setFormError('already connected');
      return;
    }
    const event = requestConnection(sk, peer);
    requestBroadcast({
      grade: 'private',
      label: 'connection request',
      content: `connect with ${npubOf(peer).slice(0, 20)}… — one signature, awaiting theirs.\nthey accept by entering your npub here and looking you up.`,
      identityPubkey: getPublicKey(sk),
      identityNote: 'connection key',
      relays: myWrite,
      extraRelays: discoveryTargets,
      events: [event],
    });
    setInput('');
  };

  return (
    <>
    <div className="space-y-4">
      {pending && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          fetching events
        </div>
      )}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          request();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="npub…"
          aria-label="npub"
          className="min-w-0 flex-1 rounded-sm"
        />
        <Button
          type="button"
          variant="outline"
          disabled={input.trim().length === 0}
          onClick={lookUp}
          className="rounded-sm"
        >
          look up
        </Button>
        <Button
          type="submit"
          variant="privacy"
          disabled={input.trim().length === 0}
          className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
        >
          request
        </Button>
      </form>
      {formError && <p className="text-destructive text-xs">{formError}</p>}

      {incoming.length > 0 && (
        <section className="space-y-1">
        <h2 className="text-xs font-semibold">incoming</h2>
          <ul>
            {incoming.map((record) => (
              <Row
                key={record.event.id}
                record={record}
                action={{
                  label: 'accept',
                  onClick: () => requestBroadcast({
                    grade: 'private',
                    label: 'connection accept',
                    content: `accept ${npubOf(record.peer).slice(0, 20)}… — two signatures, connected`,
                    identityPubkey: getPublicKey(sk),
                    identityNote: 'connection key',
                    relays: myWrite,
      extraRelays: discoveryTargets,
                    events: [acceptConnection(sk, record)],
                  }),
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section className="space-y-1">
        <h2 className="text-xs font-semibold">outgoing</h2>
          <ul>
            {outgoing.map((record) => (
              <Row key={record.event.id} record={record} />
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-1">
        <h2 className="text-xs font-semibold">connected</h2>
        {connected.length === 0 && !pending && (
          <Card className="border-dashed">
            <CardContent className="px-8 py-8 text-center">
              <p className="text-muted-foreground text-sm">no connections yet</p>
            </CardContent>
          </Card>
        )}
        <ul>
          {connected.map((record) => (
            <Row
              key={record.event.id}
              record={record}
              action={{
                label: 'close',

                onClick: () => requestBroadcast({
                  grade: 'private',
                  label: 'connection close',
                  content: `close the connection with ${npubOf(record.peer).slice(0, 20)}… — forward only`,
                  identityPubkey: getPublicKey(sk),
                  identityNote: 'connection key',
                  relays: myWrite,
      extraRelays: discoveryTargets,
                  events: [closeConnection(sk, record)],
                }),
              }}
            />
          ))}
        </ul>
      </section>
    </div>
    {dialog}
    </>
  );
};

const ConnectionsPage = () => {
  useSeoMeta({ title: 'connections — nostr.black' });
  return (
    <Page title={<PrivacyTag grade="high">connections</PrivacyTag>}>
      <ConnectionsBody />
    </Page>
  );
};

export default ConnectionsPage;
