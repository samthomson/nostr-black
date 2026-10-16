import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { getPublicKey } from 'nostr-tools';
import { Page } from '@/components/Page';
import { PrivacyTag } from '@/components/PrivacyTag';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useRouting } from '@/data/hooks/useRouting';
import { useProfiles, type Profile } from '@/data/hooks/useProfile';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useConnections } from '@/data/hooks/useConnections';
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

/**
 * The invite link: `?peer=<requester's npub>`. The recipient looks the
 * requester up (their offer lives on the requester's write relays), so
 * the link names us. It carries routing only — the connection itself is
 * authorized by the pairwise crypto, not by possessing the link.
 */
const inviteLinkOf = (me: string): string =>
  `${window.location.origin}/connections?peer=${npubOf(me)}`;

/** The name a row shows for a peer, npub-prefix fallback included. */
const displayNameOf = (record: ConnectionRecord, profile: Profile | undefined): string => {
  const metadata = profile?.metadata;
  return metadata?.display_name || metadata?.name || `${npubOf(record.peer).slice(0, 16)}…`;
};

/** One peer: avatar, name, npub — the identity block used everywhere. */
const PeerBlock = ({ record, profile }: { record: ConnectionRecord; profile: Profile | undefined }) => {
  const metadata = profile?.metadata;
  const name = displayNameOf(record, profile);
  const href = profileHref(record.peer);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <ProfileAvatar
        pubkey={record.peer}
        metadata={metadata}
        waitingMetadata={profile?.pending ?? false}
        className="size-10 shrink-0"
      />
      <div className="min-w-0">
        {href ? (
          <Link to={href} className="block truncate text-sm font-medium hover:underline">
            {profile?.pending ? '…' : name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium">{profile?.pending ? '…' : name}</span>
        )}
        <p className="text-muted-foreground truncate font-mono text-xs">{npubOf(record.peer)}</p>
      </div>
    </div>
  );
};

/** Copy-to-clipboard button with a done flash. */
const CopyLinkButton = ({ url, label = 'copy link' }: { url: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'copied' : label}
    </Button>
  );
};

/** One connected peer; remove is quiet — an action you rarely want, not
 *  one that competes with reading the list. */
const ConnectionRow = ({
  record,
  profile,
  onRemove,
}: {
  record: ConnectionRecord;
  profile: Profile | undefined;
  onRemove: () => void;
}) => (
  <li className="group flex items-center gap-3 border-b py-2 last:border-b-0">
    <PeerBlock record={record} profile={profile} />
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      onClick={onRemove}
    >
      remove
    </Button>
  </li>
);

/** A request we sent that they haven't accepted. The invite link is the
 *  action — it's the only thing that unblocks the request. */
const WaitingRow = ({
  record,
  profile,
  inviteUrl,
}: {
  record: ConnectionRecord;
  profile: Profile | undefined;
  inviteUrl: string;
}) => (
  <li className="flex items-center gap-3 border-b py-2 last:border-b-0">
    <PeerBlock record={record} profile={profile} />
    <CopyLinkButton url={inviteUrl} label="invite link" />
  </li>
);

/** Their request, waiting on us. */
const RequestRow = ({
  record,
  profile,
  onAccept,
}: {
  record: ConnectionRecord;
  profile: Profile | undefined;
  onAccept: () => void;
}) => (
  <li className="flex items-center gap-3 border-b py-2 last:border-b-0">
    <PeerBlock record={record} profile={profile} />
    <Button
      variant="privacy"
      className={cn('shrink-0', PRIVACY_BUTTON, PRIVACY.private.className)}
      onClick={onAccept}
    >
      accept
    </Button>
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
  const [filter, setFilter] = useState('');
  /** The peer of a request just broadcast — the card becomes the
   *  hand-off: their link, ready to send. Cleared by "done". */
  const [sentTo, setSentTo] = useState<string | undefined>();
  const { records, connected, outgoing, incoming, pending } = useConnections(lookup);
  const [searchParams, setSearchParams] = useSearchParams();
  const [lookedUp, setLookedUp] = useState(false);

  // One batched kind-0 want for every peer — rows and the filter read it.
  const peers = useMemo(() => records.map((r) => r.peer), [records]);
  const profiles = useProfiles(peers);

  // An invite link's ?peer= names who to look up — run it once on arrival,
  // so opening a link lands straight on their request.
  const invitePeer = searchParams.get('peer');
  if (invitePeer && !lookedUp) {
    setLookedUp(true);
    const peer = parsePubkey(invitePeer);
    if (peer) {
      setInput(npubOf(peer));
      setLookup(peer);
    }
  }

  // The router's gate guarantees a user here.
  if (!sk) {
    return (
      <p className="text-muted-foreground text-sm">
        session key required — nsec login only. an extension cannot derive aliases or open envelopes.
      </p>
    );
  }

  const me = getPublicKey(sk);
  const inviteUrl = inviteLinkOf(me);

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
      content: `connect with ${npubOf(peer).slice(0, 20)}… — one signature, awaiting theirs`,
      identityPubkey: getPublicKey(sk),
      identityNote: 'connection key',
      relays: myWrite,
      extraRelays: discoveryTargets,
      events: [event],
      // The card becomes the hand-off once this is queued.
      onEnqueued: () => setSentTo(peer),
    });
    setInput('');
  };

  const accept = (record: ConnectionRecord) => {
    requestBroadcast({
      grade: 'private',
      label: 'connection accept',
      content: `accept ${displayNameOf(record, profiles.get(record.peer))} — two signatures, connected`,
      identityPubkey: getPublicKey(sk),
      identityNote: 'connection key',
      relays: myWrite,
      extraRelays: discoveryTargets,
      events: [acceptConnection(sk, record)],
    });
    // The invite link has served its purpose once its request is accepted.
    setSearchParams({}, { replace: true });
  };

  const remove = (record: ConnectionRecord) => {
    requestBroadcast({
      grade: 'private',
      label: 'remove connection',
      content: `remove ${displayNameOf(record, profiles.get(record.peer))} — they can no longer see your new private notes`,
      identityPubkey: getPublicKey(sk),
      identityNote: 'connection key',
      relays: myWrite,
      extraRelays: discoveryTargets,
      events: [closeConnection(sk, record)],
    });
  };

  const matches = (record: ConnectionRecord): boolean => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    const profile = profiles.get(record.peer);
    const name = profile?.metadata?.display_name || profile?.metadata?.name || '';
    return name.toLowerCase().includes(needle) || npubOf(record.peer).toLowerCase().includes(needle);
  };

  const filteredIncoming = incoming.filter(matches);
  const filteredOutgoing = outgoing.filter(matches);
  const filteredConnected = connected.filter(matches);
  const showFilter = records.length > 10;
  const sentRecord = sentTo ? records.find((r) => r.peer === sentTo) : undefined;

  return (
    <>
      <div className="space-y-8">
        {pending && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            fetching events
          </div>
        )}

        {/* The one action this page starts with. After requesting, the
            card hands over the link — the thing the user must do next. */}
        <Card>
          <CardContent className="space-y-3 px-4 py-4">
            {sentRecord ? (
              sentRecord.state === 'connected' ? (
                <>
                  <p className="text-sm">
                    {displayNameOf(sentRecord, profiles.get(sentRecord.peer))} accepted — you're
                    connected. private notes you post are shared with them.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setSentTo(undefined)}>
                    done
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    request sent to{' '}
                    <span className="font-medium">
                      {displayNameOf(sentRecord, profiles.get(sentRecord.peer))}
                    </span>
                    .
                  </p>
                  <p className="text-muted-foreground text-sm">
                    they aren't notified — nothing public is. send them this link and it opens
                    your request, ready for them to accept:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-muted-foreground min-w-0 flex-1 truncate rounded-sm border px-2 py-1.5 font-mono text-xs">
                      {inviteUrl}
                    </code>
                    <CopyLinkButton url={inviteUrl} />
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSentTo(undefined)}>
                    done
                  </Button>
                </>
              )
            ) : (
              <>
                <h2 className="text-sm font-semibold">start a connection</h2>
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
                    placeholder="their npub…"
                    aria-label="npub"
                    className="min-w-0 flex-1 rounded-sm"
                  />
                  <Button
                    type="submit"
                    variant="privacy"
                    disabled={input.trim().length === 0}
                    className={cn('rounded-sm', PRIVACY_BUTTON, PRIVACY.private.className)}
                  >
                    send request
                  </Button>
                </form>
                {formError && <p className="text-destructive text-xs">{formError}</p>}
                {/* The lookup without a link: find a request someone
                    already sent. Same protocol action, second door. */}
                <button
                  type="button"
                  className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    const peer = peerOf();
                    if (peer) setLookup(peer);
                  }}
                >
                  someone said they invited you? paste their npub above and check
                </button>
              </>
            )}
          </CardContent>
        </Card>

        {showFilter && (
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter by name or npub…"
            aria-label="filter connections"
            className="rounded-sm"
          />
        )}

        {filteredIncoming.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-xs font-semibold">
              connection requests
              <span className="text-muted-foreground ml-1.5 font-normal">({filteredIncoming.length})</span>
            </h2>
            <ul>
              {filteredIncoming.map((record) => (
                <RequestRow
                  key={record.event.id}
                  record={record}
                  profile={profiles.get(record.peer)}
                  onAccept={() => accept(record)}
                />
              ))}
            </ul>
          </section>
        )}

        {filteredOutgoing.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-xs font-semibold">
              pending connections
              <span className="text-muted-foreground ml-1.5 font-normal">({filteredOutgoing.length})</span>
            </h2>
            <p className="text-muted-foreground text-xs">
              they haven't accepted yet — the invite link on each row is what gets you there
            </p>
            <ul>
              {filteredOutgoing.map((record) => (
                <WaitingRow
                  key={record.event.id}
                  record={record}
                  profile={profiles.get(record.peer)}
                  inviteUrl={inviteUrl}
                />
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-1">
          <h2 className="text-xs font-semibold">
            your connections
            <span className="text-muted-foreground ml-1.5 font-normal">({filteredConnected.length})</span>
          </h2>
          {connected.length === 0 && !pending && (
            <Card className="border-dashed">
              <CardContent className="px-8 py-8 text-center">
                <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                  none yet — the people you connect with are who your private notes reach
                </p>
              </CardContent>
            </Card>
          )}
          <ul>
            {filteredConnected.map((record) => (
              <ConnectionRow
                key={record.event.id}
                record={record}
                profile={profiles.get(record.peer)}
                onRemove={() => remove(record)}
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
