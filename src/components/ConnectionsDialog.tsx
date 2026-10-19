import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useProfiles } from '@/data/hooks/useProfile';
import { npubOf } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

export type ConnectionsTab = 'following' | 'followers' | 'relays';

const TABS: readonly { id: ConnectionsTab; label: string }[] = [
  { id: 'following', label: 'following' },
  { id: 'followers', label: 'followers' },
  { id: 'relays', label: 'relays' },
];

/**
 * A profile's public graph, one dialog three ways: who they follow, who
 * follows them, and their NIP-65 relay list. People rows (avatar, name,
 * npub) under the first two tabs; `read`/`write` relay rows under the last.
 * The active tab is controlled — the profile picks which stat opens which.
 */
export const ConnectionsDialog = ({
  following,
  followers,
  read,
  write,
  tab,
  onTab,
  open,
  onOpenChange,
}: {
  following: readonly string[];
  followers: readonly string[];
  read: readonly string[];
  write: readonly string[];
  tab: ConnectionsTab;
  onTab: (tab: ConnectionsTab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const people = tab === 'followers' ? followers : following;
  const profiles = useProfiles(open && tab !== 'relays' ? people : [], 'interactive');

  const relayRows = [...new Set([...read, ...write])].map((url) => ({
    url,
    read: read.includes(url),
    write: write.includes(url),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70dvh] max-w-[95vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 pt-4 pb-3">
          <DialogTitle className="text-sm font-semibold">
            {tab === 'relays'
              ? `relays ${relayRows.length || '…'}`
              : `${tab} ${people.length || '…'}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-1 border-b px-4 py-2">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTab(id)}
              className={cn(
                'cursor-pointer rounded-sm px-2 py-1 text-xs transition-colors',
                tab === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'relays' ? (
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {relayRows.map(({ url, read: isRead, write: isWrite }) => (
              <li key={url} className="flex items-center gap-2 px-4 py-2.5">
                <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">{url}</span>
                <span className="flex shrink-0 gap-1">
                  {isRead && <span className="rounded-sm bg-privacy-public-soft px-1.5 py-0.5 text-[10px] leading-none text-privacy-public-fg">read</span>}
                  {isWrite && <span className="rounded-sm bg-privacy-public px-1.5 py-0.5 text-[10px] leading-none text-privacy-public-fg">write</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
            {people.map((person) => {
              const metadata = profiles.get(person)?.metadata;
              const name = metadata?.display_name || metadata?.name;
              return (
                <li key={person}>
                  <Link
                    to={`/${npubOf(person)}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent"
                  >
                    <ProfileAvatar
                      pubkey={person}
                      metadata={metadata}
                      waitingMetadata={!metadata}
                      className="size-9 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{name ?? '…'}</span>
                      <span className="text-muted-foreground block truncate font-mono text-xs">{npubOf(person)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
};
