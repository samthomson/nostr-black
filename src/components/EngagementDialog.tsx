import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useProfiles } from '@/data/hooks/useProfile';
import { npubOf, profileHref } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EMOJI_CHOICES, ENGAGEMENT_TABS, type EngagementTab } from '@/lib/engagementKinds';

/** A person in the viewer, whatever they did. */
export interface EngagementRow {
  pubkey: string;
  /** What they did — an emoji reaction, or nothing for a repost. */
  content?: string;
  id: string;
}

/** Hold the icon this long before the picker opens instead of the click. */
const HOLD_MS = 500;

/**
 * Who engaged: pure output. One row per person (avatar, name, npub,
 * their emoji), under a tab per kind. Opens directly on the tab whose
 * number was clicked.
 */
export const EngagementDialog = ({
  open,
  onOpenChange,
  tab,
  onTab,
  reactions,
  reposts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: EngagementTab;
  onTab: (tab: EngagementTab) => void;
  reactions: readonly EngagementRow[];
  reposts: readonly EngagementRow[];
}) => {
  const rows = tab === 'reactions' ? reactions : reposts;
  const profiles = useProfiles(open ? rows.map((r) => r.pubkey) : [], 'interactive');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-[95vw] gap-0 overflow-hidden rounded-sm p-0 sm:max-w-md">
        <DialogHeader className="border-b px-4 pt-4 pb-3">
          <DialogTitle className="text-sm font-semibold">
            {tab === 'reactions'
              ? reactions.length === 1 ? '1 reaction' : `${reactions.length} reactions`
              : reposts.length === 1 ? '1 repost' : `${reposts.length} reposts`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex gap-1 border-b px-4 pt-2">
          {ENGAGEMENT_TABS.map((id) => (
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
              {id}
            </button>
          ))}
        </div>
        <ul className="max-h-[60dvh] divide-y overflow-y-auto">
          {rows.map((row) => {
            const metadata = profiles.get(row.pubkey)?.metadata;
            const name = metadata?.display_name || metadata?.name;
            return (
              <li key={row.id}>
                <Link
                  to={profileHref(row.pubkey) ?? '#'}
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent"
                >
                  <ProfileAvatar
                    pubkey={row.pubkey}
                    metadata={metadata}
                    waitingMetadata={!metadata}
                    className="size-9 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{name ?? '…'}</span>
                    <span className="text-muted-foreground block truncate font-mono text-xs">
                      {npubOf(row.pubkey)}
                    </span>
                  </span>
                  {row.content && <span className="shrink-0 text-sm">{row.content}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
};

/**
 * The one engagement affordance: icon left, underlined count right.
 *
 * - The icon starts the action: click is `onEngage`. When `onChoose` is
 *   present (reactions), holding the icon half a second opens the emoji
 *   picker and a choice calls `onChoose(emoji)` instead.
 * - The count is the state: a spinner while the engagement want is
 *   still fetching, the number otherwise (0 for none). Clicking it
 *   opens the viewer on this affordance's tab.
 */
export const EngagementCount = ({
  icon,
  count,
  pending,
  mine,
  tab,
  reactions,
  reposts,
  onEngage,
  onChoose,
  onShow,
  ariaLabel,
}: {
  icon: React.ReactNode;
  count: number;
  /** The engagement want has not finished a run — the number is unknown. */
  pending: boolean;
  /** True when the current user's own engagement is on the note. */
  mine: boolean;
  tab: EngagementTab;
  reactions: readonly EngagementRow[];
  reposts: readonly EngagementRow[];
  /** Icon click — the action, whatever it is for this kind. */
  onEngage: () => void;
  /** Present (reactions) when an emoji picker is offered on long-press. */
  onChoose?: (emoji: string) => void;
  /** Count click. Defaults to opening the viewer; replies open the note. */
  onShow?: () => void;
  ariaLabel: string;
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerTab, setViewerTab] = useState<EngagementTab>(tab);
  const [pickerOpen, setPickerOpen] = useState(false);
  const heldFor = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startPress = () => {
    heldFor.current = false;
    if (!onChoose) return;
    pressTimer.current = setTimeout(() => {
      heldFor.current = true;
      setPickerOpen(true);
    }, HOLD_MS);
  };
  const endPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
    if (!heldFor.current) onEngage();
  };
  const cancelPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className={cn(
          'text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground',
          mine && 'text-foreground',
        )}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={cancelPress}
        aria-label={ariaLabel}
        aria-pressed={mine}
      >
        {icon}
      </button>
      <button
        type="button"
        className="text-muted-foreground inline-flex cursor-pointer items-center hover:text-foreground"
        onClick={() => (onShow ? onShow() : setViewerOpen(true))}
        aria-label={`${ariaLabel}s`}
        data-testid={`count-${ariaLabel}`}
      >
        {pending
          ? <Loader2 className="size-3 animate-spin" />
          : <span className="text-xs underline underline-offset-2">{count}</span>}
      </button>

      {pickerOpen && (
        <Dialog open onOpenChange={setPickerOpen}>
          <DialogContent className="max-w-[95vw] rounded-sm p-4 sm:max-w-xs">
            <DialogHeader className="pb-1">
              <DialogTitle className="text-sm font-semibold">react with</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-4 gap-1">
              {EMOJI_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="cursor-pointer rounded-sm px-2 py-1.5 text-base hover:bg-accent"
                  onClick={() => { setPickerOpen(false); onChoose?.(emoji); }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <EngagementDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        tab={viewerTab}
        onTab={setViewerTab}
        reactions={reactions}
        reposts={reposts}
      />
    </span>
  );
};
