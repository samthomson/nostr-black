import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Loader2, RefreshCw } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Shell } from '@/components/Shell';
import { useAppContext } from '@/hooks/useAppContext';
import { useUserState } from '@/hooks/useUserState';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishRelayList } from '@/hooks/useTransport';
import { useMediaCache } from '@/hooks/useMediaCache';
import { Link } from 'react-router-dom';

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

/** Section wrapper — settings is a stack of these. */
const Section = ({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-3 rounded-lg border p-4">
    <h2 className="text-sm font-semibold uppercase tracking-wide">
      {title}
      {hint && <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground text-xs">{hint}</span>}
    </h2>
    {children}
  </section>
);

const SettingsBody = () => {
  const { config, updateConfig } = useAppContext();
  const { state: userState, bumpRelaySync } = useUserState();
  const { user } = useCurrentUser();
  const publishListMutation = usePublishRelayList();
  const syncedAt = userState.relayMetadata.updatedAt;

  const [draft, setDraft] = useState<string | null>(null);
  const [newRelay, setNewRelay] = useState('');
  const [publishState, setPublishState] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const mediaCache = useMediaCache();
  const [maxMb, setMaxMbInput] = useState(String(config.mediaCacheMaxMb));

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

  const saveCacheMax = async () => {
    const mb = Math.max(1, Math.floor(Number(maxMb) || 0));
    await mediaCache.setMaxMb(mb);
    updateConfig((current) => ({ ...current, mediaCacheMaxMb: mb }));
    setMaxMbInput(String(mb));
  };

  const clearCache = () => mediaCache.clear();

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
            className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            add
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={publishList}
            disabled={!user || !dirty || publishState === 'publishing'}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            {publishState === 'publishing' ? 'publishing…' : 'publish list'}
          </button>
          <button
            type="button"
            onClick={() => {
              setRelays(userState.relayMetadata.relays);
              bumpRelaySync();
            }}
            className="text-muted-foreground flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <RefreshCw className="size-3" />
            resync
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => setRelays(userState.relayMetadata.relays)}
              className="text-muted-foreground rounded-full px-3 py-1.5 text-xs font-medium hover:bg-accent"
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
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground"
            >
              save
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-muted-foreground rounded-full px-4 py-1.5 text-sm font-medium hover:bg-accent"
            >
              cancel
            </button>
          </div>
        )}
      </Section>

      <Section title="media" hint="fetched through the same route as relay traffic">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={config.mediaEnabled}
            onChange={(e) =>
              updateConfig((current) => ({ ...current, mediaEnabled: e.target.checked }))}
          />
          show images and video
        </label>

        {mediaCache.enabled && (
          <div className="space-y-1 pt-1">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <Loader2 className={`size-3 ${mediaCache.bytes > 0 ? 'animate-spin' : 'hidden'}`} />
              cache {(mediaCache.bytes / 1024 / 1024).toFixed(1)} MB of{' '}
              {(mediaCache.maxBytes / 1024 / 1024).toFixed(0)} MB
            </p>
            <div className="flex items-center gap-2">
              <input
                className="w-20 rounded-md border bg-transparent px-2 py-1 font-mono text-xs"
                value={maxMb}
                onChange={(e) => setMaxMbInput(e.target.value)}
                onBlur={saveCacheMax}
                inputMode="numeric"
                aria-label="media cache max MB"
              />
              <span className="text-muted-foreground text-xs">MB max — oldest media evicted first</span>
              <button
                type="button"
                onClick={clearCache}
                className="text-muted-foreground rounded-full px-3 py-1 text-xs font-medium hover:bg-accent"
              >
                clear cache
              </button>
            </div>
          </div>
        )}
      </Section>

      {user && (
        <p className="text-muted-foreground text-xs">
          logged in as {nip19.npubEncode(user.pubkey).slice(0, 12)}… —{' '}
          <Link to={`/${nip19.npubEncode(user.pubkey)}`} className="underline underline-offset-2">
            your profile
          </Link>
        </p>
      )}
    </div>
  );
};

const SettingsPage = () => {
  useSeoMeta({ title: 'settings — nostr.black' });
  const { user } = useCurrentUser();

  // Logged-out settings (discovery relays, pre-login) render inside the
  // landing page, not the app shell — the shell's other tabs need a session.
  if (!user) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <SettingsBody />
      </div>
    );
  }

  return (
    <Shell>
      <SettingsBody />
    </Shell>
  );
};

export default SettingsPage;
