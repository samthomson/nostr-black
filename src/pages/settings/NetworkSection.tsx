import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishRelayList, useMaxConnections } from '@/hooks/useTransport';
import { normalizeRelayUrl } from '@/lib/appRelays';
import { Button } from '@/components/ui/button';
import { Section } from './Section';

/** One row of a relay list: url, optional read/write toggles, remove. */
const RelayRow = ({
  url,
  read,
  write,
  onToggleRead,
  onToggleWrite,
  onRemove,
}: {
  url: string;
  read?: boolean;
  write?: boolean;
  onToggleRead?: () => void;
  onToggleWrite?: () => void;
  onRemove: () => void;
}) => (
  <li className="flex items-center gap-3 border-b py-2 last:border-b-0">
    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>{url}</span>
    {onToggleRead && (
      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs">
        <input type="checkbox" className="size-3.5 accent-foreground" checked={read} onChange={onToggleRead} />
        read
      </label>
    )}
    {onToggleWrite && (
      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs">
        <input type="checkbox" className="size-3.5 accent-foreground" checked={write} onChange={onToggleWrite} />
        write
      </label>
    )}
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onRemove}
      aria-label={`remove ${url}`}
      className="text-muted-foreground text-xs"
    >
      ×
    </Button>
  </li>
);

/** The add-row shared by both relay lists: url input + add button. */
const AddRelayRow = ({
  value,
  onChange,
  onAdd,
}: {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}) => (
  <div className="flex gap-2 pt-1">
    <input
      className="min-w-0 flex-1 rounded-sm border bg-transparent px-2 py-1.5 font-mono text-xs"
      placeholder="wss://relay.example.com"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onAdd()}
      spellCheck={false}
    />
    <Button variant="outline" size="sm" onClick={onAdd}>add</Button>
  </div>
);

export const NetworkSection = () => {
  const { config, updateConfig } = useAppContext();
  const { state: userState, bumpRelaySync } = useUserState();
  const { user } = useCurrentUser();
  const publishListMutation = usePublishRelayList();
  const syncedAt = userState.relayMetadata.updatedAt;
  const maxConnections = useMaxConnections();

  const [newRelay, setNewRelay] = useState('');
  const [newDiscovery, setNewDiscovery] = useState('');
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');

  // Local working copy of the relay list; "publish" writes it to nostr as a
  // fresh kind 10002 and updates config optimistically on success.
  const [relays, setRelays] = useState(userState.relayMetadata.relays);
  const dirty = JSON.stringify(relays) !== JSON.stringify(userState.relayMetadata.relays);
  // Local working copy of the discovery relays; "save" writes it to config.
  const [discovery, setDiscovery] = useState(config.discoveryRelays);
  const discoveryDirty = discovery.join('\n') !== config.discoveryRelays.join('\n');

  const addDiscoveryRelay = () => {
    const url = normalizeRelayUrl(newDiscovery);
    if (url === undefined || discovery.includes(url)) return;
    setDiscovery((current) => [...current, url]);
    setNewDiscovery('');
  };

  const saveDiscoveryList = () => {
    updateConfig((current) => ({ ...current, discoveryRelays: discovery }));
  };

  const addRelay = () => {
    const url = normalizeRelayUrl(newRelay);
    if (url === undefined || relays.some((r) => r.url === url)) return;
    setRelays((current) => [...current, { url, read: true, write: true }]);
    setNewRelay('');
  };

  const publishList = () => {
    if (!user) return;
    setPublishState('publishing');
    publishListMutation.mutate(relays, {
      onSuccess: () => setPublishState('done'),
      onError: () => setPublishState('error'),
    });
  };

  return (
    <div className="space-y-8">
      <Section
        title="relays"
        hint={
          syncedAt > 0
            ? `${userState.relayMetadata.relays.length} in your kind 10002 (won ${new Date(syncedAt * 1000).toLocaleString()})`
            : 'not fetched yet — log in and your list will appear here'
        }
      >
        <h3 className="text-xs font-medium text-muted-foreground">your relays — where others find you (NIP-65)</h3>
        {relays.length === 0 ? (
          <p className="text-muted-foreground text-sm">(empty)</p>
        ) : (
          <ul>
            {relays.map((r) => (
              <RelayRow
                key={r.url}
                url={r.url}
                read={r.read}
                write={r.write}
                onToggleRead={() =>
                  setRelays((current) =>
                    current.map((x) => (x.url === r.url ? { ...x, read: !x.read } : x)))}
                onToggleWrite={() =>
                  setRelays((current) =>
                    current.map((x) => (x.url === r.url ? { ...x, write: !x.write } : x)))}
                onRemove={() =>
                  setRelays((current) => current.filter((x) => x.url !== r.url))}
              />
            ))}
          </ul>
        )}

        <AddRelayRow value={newRelay} onChange={setNewRelay} onAdd={addRelay} />

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={publishList}
            disabled={!user || !dirty || publishState === 'publishing'}
          >
            {publishState === 'publishing' ? 'publishing…' : 'publish list'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setRelays(userState.relayMetadata.relays);
              bumpRelaySync();
            }}
          >
            <RefreshCw className="size-3" />
            resync
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setRelays(userState.relayMetadata.relays)}
            >
              discard
            </Button>
          )}
          {publishState === 'done' && <span className="text-xs text-emerald-600">published</span>}
          {publishState === 'error' && <span className="text-xs text-red-500">publish failed</span>}
        </div>
        {!user && (
          <p className="text-muted-foreground text-xs">
            log in to edit your relay list — it publishes a new kind 10002 signed by you
          </p>
        )}

        <h3 className="pt-4 text-xs font-medium text-muted-foreground">
          discovery relays — where this app looks up your lists (never feed content)
        </h3>
        {discovery.length === 0 ? (
          <p className="text-muted-foreground text-sm">(empty)</p>
        ) : (
          <ul>
            {discovery.map((url) => (
              <RelayRow
                key={url}
                url={url}
                onRemove={() => setDiscovery((current) => current.filter((x) => x !== url))}
              />
            ))}
          </ul>
        )}

        <AddRelayRow value={newDiscovery} onChange={setNewDiscovery} onAdd={addDiscoveryRelay} />

        {discoveryDirty && (
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" onClick={saveDiscoveryList}>save</Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setDiscovery(config.discoveryRelays)}
            >
              discard
            </Button>
          </div>
        )}
      </Section>

      <Section title="connections" hint="how many relays this app talks to at once">
        {/* TODO: make this editable — it should drive setMaxConnections() from
            src/net/pool.ts, and drop automatically when tor is on, since a
            circuit costs far more than a socket. read-only until then. */}
        <div className="flex items-center gap-2">
          <input
            className="w-20 rounded-sm border bg-transparent px-2 py-1 font-mono text-xs disabled:opacity-40"
            value={maxConnections}
            disabled
            readOnly
            aria-label="max simultaneous relay connections"
          />
          <span className="text-muted-foreground text-xs">
            simultaneous relay connections — not editable yet
          </span>
        </div>
      </Section>
    </div>
  );
};
