import { useState } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Shell } from '@/components/Shell';
import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Link } from 'react-router-dom';

/**
 * Settings page: relay configuration. The user's NIP-65 relay list (fetched,
 * never hardcoded) is shown once synced; discovery relays are hardcoded
 * defaults, editable here — used only to find the user's own lists, never
 * for feed content.
 */
const SettingsBody = () => {
  const { config, updateConfig } = useAppContext();
  const syncedAt = config.relayMetadata.updatedAt;
  const [draft, setDraft] = useState<string | null>(null);

  const saveDiscovery = () => {
    const relays = (draft ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((url) => /^wss?:\/\/\S+$/.test(url));
    updateConfig((current) => ({ ...current, discoveryRelays: relays }));
    setDraft(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">
          your relays{' '}
          <span className="text-muted-foreground text-xs">
            {syncedAt > 0
              ? `fetched from your NIP-65 list (${new Date(syncedAt * 1000).toLocaleString()})`
              : 'not fetched yet — log in and your list will appear here'}
          </span>
        </p>
        {config.relayMetadata.relays.length === 0 ? (
          <p className="text-muted-foreground text-sm">(empty)</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {config.relayMetadata.relays.map((r) => (
              <li key={r.url} className="flex items-baseline gap-2">
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {r.read ? 'r' : '·'}
                  {r.write ? 'w' : '·'}
                </span>
                <span className="truncate">{r.url}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          discovery relays{' '}
          <span className="text-muted-foreground text-xs">
            where your own lists are looked up — never used for feed content
          </span>
        </p>
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
      </div>
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4">
        <h1 className="text-3xl font-bold tracking-tight">nostr.black</h1>
        <div className="w-full max-w-md space-y-6">
          <SettingsBody />
        </div>
        <Link to="/" className="text-muted-foreground text-sm underline underline-offset-4">
          back
        </Link>
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
