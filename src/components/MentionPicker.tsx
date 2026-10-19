import { ProfileAvatar } from '@/components/ProfileAvatar';
import { mentionLabelOf, type MentionCandidate } from '@/lib/mentions';
import { cn } from '@/lib/utils';

/**
 * The `@` typeahead dropdown: the matching follows, avatar + name rows,
 * best match first. Keyboard-driven — the composer walks the highlight
 * with the arrow keys and Enter picks the lit row; a hover highlights
 * too, and picking happens on mousedown so the textarea's blur never
 * closes the dropdown before the pick lands. While the follow list is
 * still syncing (or the query matches nobody) a status row says so —
 * the dropdown is never a silent empty box.
 */
export const MentionPicker = ({
  matches,
  query,
  syncing,
  highlighted,
  onHighlight,
  onPick,
}: {
  matches: readonly MentionCandidate[];
  /** Mirrors the typed `@run` so the row set reads as search results. */
  query: string;
  /** The follow list is still syncing from relays — rows will land. */
  syncing: boolean;
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (candidate: MentionCandidate) => void;
}) => {
  const empty = matches.length === 0;
  const status = syncing
    ? 'syncing follows…'
    : empty
      ? 'no matches — you follow nobody by that name'
      : null;
  return (
    <div className="w-72 border bg-popover text-popover-foreground shadow-md">
      <div
        aria-label="mention search"
        className="text-muted-foreground w-full border-b px-3 py-2 text-sm"
      >
        {query.length > 0 ? `@${query}` : '@'}
      </div>
      {status !== null ? (
        <p className="text-muted-foreground px-3 py-2 text-sm">{status}</p>
      ) : (
        <ul role="listbox" aria-label="people you follow">
          {matches.map((candidate, i) => (
            <li key={candidate.pubkey} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                  // `bg-accent` sits 1% off `bg-popover` (1.05:1 — invisible),
                  // so the highlight follows the house chip-input pattern:
                  // tinted surface plus a foreground ring the eye catches.
                  i === highlighted
                    ? 'bg-secondary ring-1 ring-foreground/40'
                    : 'hover:bg-secondary',
                )}
                onMouseEnter={() => onHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(candidate);
                }}
              >
                <ProfileAvatar
                  pubkey={candidate.pubkey}
                  metadata={candidate.metadata}
                  className="size-6"
                />
                <span className="truncate">{mentionLabelOf(candidate)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
