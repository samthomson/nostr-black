import { EmojiPicker as Frimousse, type EmojiPickerListEmojiProps } from 'frimousse';

import { bundledEmojiData } from '@/lib/emojiData';
import { cn } from '@/lib/utils';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  /** Controlled search text — drives the typeahead from the composer. */
  query?: string;
  /** Compact variant for the composer's `:` dropdown. */
  compact?: boolean;
  /** Focus lands on the search box on mount (full picker only). */
  autoFocus?: boolean;
  /** Receives the search input, so a caller can hand it focus (the
   *  composer's ArrowDown → dropdown keyboard handoff). */
  searchRef?: React.Ref<HTMLInputElement>;
}

/**
 * The one emoji picker: a searchable, native-emoji popover (frimousse,
 * data bundled — nothing loads off-origin). Used for reactions, the
 * composer's emoji button, and — compact, query-driven — the composer's
 * `:` typeahead dropdown. Presentational; the caller decides what a
 * picked emoji does.
 */
export const EmojiPicker = ({ onSelect, query, compact = false, autoFocus = false, searchRef }: EmojiPickerProps) => (
  <Frimousse.Root
    resolveEmojiData={bundledEmojiData}
    className={cn(
      'isolate flex flex-col rounded-sm bg-popover text-popover-foreground',
      compact ? 'h-48 w-56' : 'h-72 w-64',
    )}
    onEmojiSelect={({ emoji }) => onSelect(emoji)}
  >
    <Frimousse.Search
      {...(query !== undefined ? { value: query } : {})}
      autoFocus={autoFocus}
      ref={searchRef}
      placeholder="search…"
      className="shrink-0 border-b border-input px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground"
    />
    <Frimousse.Loading className="p-2 text-sm text-muted-foreground">
      loading…
    </Frimousse.Loading>
    <Frimousse.Empty className="p-2 text-sm text-muted-foreground">
      no emoji found
    </Frimousse.Empty>
    <Frimousse.Viewport className="min-h-0 flex-1 outline-none">
      <Frimousse.List
        className="pb-1 select-none"
        components={{
          CategoryHeader: ({ category, ...props }) => (
            <div
              {...props}
              className="bg-popover px-2 pb-1 pt-2 text-[11px] text-muted-foreground"
            >
              {category.label}
            </div>
          ),
          Emoji: ({ emoji, ...props }: EmojiPickerListEmojiProps) => (
            <button
              {...props}
              role="gridcell"
              type="button"
              className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-lg outline-none data-[active]:bg-accent"
              aria-label={emoji.label}
              // pick on pointerdown, straight through onSelect — not
              // frimousse's click path: inside a radix popover its
              // store-registered select can race the popover's own
              // re-renders and drop the pick
              onPointerDown={(e) => {
                e.preventDefault();
                onSelect(emoji.emoji);
              }}
            >
              {emoji.emoji}
            </button>
          ),
        }}
      />
    </Frimousse.Viewport>
  </Frimousse.Root>
);
