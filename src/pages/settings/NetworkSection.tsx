import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishRelayList, useMaxConnections } from '@/hooks/useTransport';
import { Section } from './Section';

/** One row of the user's NIP-65 relay list: url + read/write toggles + remove. */
const RelayRow = ({
  url,
  read,
  write,
  onToggleRead,
  onToggleWrite,
  onRemove,
}: {
  url: string;
  read: boolean;
  write: boolean;
  onToggleRead: () => void;
  onToggleWrite: () => void;
  onRemove: () => void;
}) => (
  <li className="flex items-center gap-3 border-b py-2 last:border-b-0">
    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>{url}</span>
    <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs">
      <input type="checkbox" className="size-3.5 accent-foreground" checked={read} onChange={onToggleRead} />
      read
    </label>
    <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs">
      <input type="checkbox" className="size-3.5 accent-foreground" checked={write} onChange={onToggleWrite} />
      write
    </label>
    <button
      type="button"
      onClick={onRemove}
      aria-label={`remove ${url}`}
      className="text-muted-foreground shrink-0 rounded-sm px-1.5 py-1 text-xs hover:bg-accent"
    >
      ×
    </button>
  </li>
);

export const NetworkSection = () => {
  const { config, updateConfig } = useAppContext();
  const { state: userState, bumpRelaySync } = useUserState();
  const { user } = useCurrentUser();
  const publishListMutation = usePublishRelayList();
  const syncedAt = userState.relayMetadata.updatedAt;
  const maxConnections = useMaxConnections();

  const [draft, setDraft] = useState<string | null>(null);
  const [newRelay, setNewRelay] = useState('');
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');

  // Local working copy of the relay list; "publish" writes it to nostr as a
  // fresh kind 10002 and updates config optimistically on success.
  const [relays, setRelays] = useState(userState.relayMetadata.relays);
  const dirty = JSON.stringify(relays) !== JSON.stringify(userState.relayMetadata.relays);

  const saveDiscovery = () => {
    const list = (draft ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((url) => /^wss?:\/\/\S+$/.test(url));
    updateConfig((current) => ({ ...current, discoveryRelays: list }));
    setDraft(null);
  };

  const addRelay = () => {
    const url = newRelay.trim().replace(/\/$/, '') + '/';
    if (!/^wss:\/\/\S+$/.test(url) || relays.some((r) => r.url === url)) return;
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

        <div className="flex gap-2 pt-1">
          <input
            className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1.5 font-mono text-xs"
            placeholder="wss://relay.example.com"
            value={newRelay}
            onChange={(e) => setNewRelay(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRelay()}
            spellCheck={false}
          />
          <button
            type="button"
            onClick={addRelay}
            className="rounded-sm border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            add
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={publishList}
            disabled={!user || !dirty || publishState === 'publishing'}
            className="rounded-sm bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            {publishState === 'publishing' ? 'publishing…' : 'publish list'}
          </button>
          <button
            type="button"
            onClick={() => {
              setRelays(userState.relayMetadata.relays);
              bumpRelaySync();
            }}
            className="text-muted-foreground flex items-center gap-1 rounded-sm px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="size-3" />
            resync
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => setRelays(userState.relayMetadata.relays)}
              className="text-muted-foreground rounded-sm px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              discard
            </button>
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
        <textarea
          className="min-h-28 w-full rounded-md border bg-transparent p-3 font-mono text-xs"
          value={draft ?? config.discoveryRelays.join('\n')}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
        {draft !== null && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveDiscovery}
              className="rounded-sm bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
            >
              save
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-muted-foreground rounded-sm px-4 py-1.5 text-sm font-medium hover:bg-accent"
            >
              cancel
            </button>
          </div>
        )}
      </Section>

      <Section title="connections" hint="how many relays this app talks to at once">
        {/* TODO: make this editable — it should drive setMaxConnections() from
            src/net/pool.ts, and drop automatically when tor is on, since a
            circuit costs far more than a socket. read-only until then. */}
        <div className="flex items-center gap-2">
          <input
            className="w-20 rounded-md border bg-transparent px-2 py-1 font-mono text-xs disabled:opacity-40"
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
