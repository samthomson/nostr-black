import { useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Smile, X } from 'lucide-react';
import { UPLOADABLE_IMAGE_ACCEPT } from '@/lib/imageCompress';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { PRIVACY, PRIVACY_BUTTON, type PrivacyGrade } from '@/lib/privacy';
import { searchEmoji } from '@/lib/emojiData';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/hooks/useAttachments';

type ComposerVariant = 'post' | 'reply' | 'edit';

/**
 * The one text-input surface for notes, in three shapes:
 *  - post: a feed's top composer (placeholder asks the grade's question)
 *  - reply: the thread composer under an opened note (enter submits)
 *  - edit: the inline editor for a note you own (prefilled, save/cancel)
 * The card wears the privacy grade of what you're writing (public =
 * white, private = black); the textarea grows with content to a cap, then
 * scrolls. Presentational only — the caller owns the draft, the staged
 * attachments and their upload. Emoji goes in two ways: the smiley button
 * (full picker) or typing `:query` (typeahead; enter picks, esc dismisses).
 */
export const Composer = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  variant,
  grade,
  attachments,
  onAddFiles,
  onRemoveAttachment,
}: {
  value: string;
  onChange: (value: string) => void;
  /** post/reply: broadcast or send. edit: save. */
  onSubmit: () => void;
  /** edit only: abandon the changes. */
  onCancel?: () => void;
  busy?: boolean;
  variant: ComposerVariant;
  /** Privacy of the thing being written — the card's colour. */
  grade: PrivacyGrade;
  /** Staged images, shown as a thumbnail strip under the text. */
  attachments?: readonly Attachment[];
  /** Present to offer the attach button; receives picked image files. */
  onAddFiles?: (files: File[]) => void;
  /** Remove one staged image (its X). */
  onRemoveAttachment?: (id: string) => void;
}) => {
  const placeholder =
    variant === 'post' ? (grade === 'private' ? 'what are you doing?' : "what's happening?")
    : variant === 'reply' ? 'reply…'
    : 'edit note';
  const submitLabel = variant === 'edit' ? 'save' : variant === 'reply' ? 'reply' : 'broadcast';
  // The reply composer is compact: one line tall, growing to three before
  // it scrolls; padding and footer shrink to match.
  const compact = variant === 'reply';
  const canSubmit = (value.trim().length > 0 || (attachments?.length ?? 0) > 0) && !busy;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // `:` typeahead — when the caret sits in a `:query` run, the same
  // picker UI opens as a small dropdown, live-filtered by the query;
  // picking one replaces the whole run with the emoji. Escape dismisses
  // it until the query changes — otherwise refocusing the textarea
  // (still inside the `:` run) instantly reopens it.
  const [typeahead, setTypeahead] = useState<{ query: string; start: number } | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const hasMatches = typeahead ? searchEmoji(typeahead.query, 1).length > 0 : false;
  const open = typeahead !== null && hasMatches && dismissedAt !== typeahead.start;
  /** The dropdown's search input — ArrowDown hands it focus, and from
   *  there frimousse owns arrows + Enter like any picker. */
  const dropdownRef = useRef<HTMLInputElement>(null);

  /** The `:query` run the caret is in, or null. Max 32 chars, no
   *  whitespace — past that it's prose, not a shortcode. */
  const typeaheadRun = (text: string, caret: number): { query: string; start: number } | null => {
    let start = -1;
    for (let i = caret - 1; i >= 0 && caret - i <= 32; i--) {
      const ch = text[i];
      if (ch === ' ' || ch === '\n' || ch === ':') {
        start = ch === ':' ? i : -1;
        break;
      }
    }
    if (start === -1) return null;
    return { query: text.slice(start + 1, caret), start };
  };

  /** Re-read the caret after a value change / click / arrow key. Reads
   *  the live textarea value, not the prop — the rAF after a keystroke
   *  can run before React commits the new value to this component. */
  const syncTypeahead = () => {
    const el = textareaRef.current;
    if (!el) {
      setTypeahead(null);
      return;
    }
    const caret = el.selectionStart ?? 0;
    setTypeahead(caret !== el.selectionEnd ? null : typeaheadRun(el.value, caret));
  };

  const pickTypeahead = (emoji: string) => {
    if (!typeahead) return;
    const el = textareaRef.current;
    const end = el?.selectionStart ?? 0;
    const next = `${value.slice(0, typeahead.start)}${emoji} ${value.slice(end)}`;
    onChange(next);
    setTypeahead(null);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = typeahead.start + emoji.length + 1;
      el?.setSelectionRange(caret, caret);
    });
  };

  /** Insert at the cursor, keep the caret on it, and hand the new value
   *  to the caller (the draft lives upstream). */
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    onChange(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + emoji.length;
      el?.setSelectionRange(caret, caret);
    });
  };

  // Grow the input to its content (capped by max-h, which then scrolls).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className={cn(
      'group rounded-sm border border-input shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
      variant === 'edit' ? 'bg-transparent' : PRIVACY[grade].surface,
    )}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); requestAnimationFrame(syncTypeahead); }}
        onSelect={syncTypeahead}
        onClick={syncTypeahead}
        placeholder={placeholder}
        aria-label={placeholder}
        onBlur={(e) => {
          // moving focus into the typeahead dropdown must not close it —
          // only a blur to somewhere else does
          if (!e.relatedTarget || !dropdownRef.current?.contains(e.relatedTarget as Node)) {
            setTypeahead(null);
          }
        }}
        onKeyDown={(e) => {
          // Shift+Enter is a plain newline, always — the universal
          // "don't submit" pattern. Plain Enter submits only in the
          // reply composer; elsewhere it needs meta/ctrl.
          //
          // While the typeahead dropdown is up, ArrowDown hands focus to
          // it — from there frimousse owns the keys (arrows walk the
          // grid, Enter picks, Escape… handled in the dropdown below).
          if (open && e.key === 'ArrowDown') {
            e.preventDefault();
            dropdownRef.current?.focus();
            return;
          }
          if (e.key !== 'Enter' || e.shiftKey) return;
          if ((e.metaKey || e.ctrlKey || variant === 'reply') && canSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onPaste={(e) => {
          if (!onAddFiles) return;
          const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (images.length === 0) return;
          e.preventDefault();
          onAddFiles(images);
        }}
      />

      {open && (
        <div className="relative px-3">
          {/* anchored dropdown under the input — the same picker UI as the
              smiley button, compact and query-driven by the `:` run */}
          <div
            className="absolute top-1 left-3 z-40 shadow-md"
            onKeyDown={(e) => {
              // frimousse doesn't consume Escape — dismiss (latched to
              // this run) and hand the caret back to the textarea
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDismissedAt(typeahead.start);
                setTypeahead(null);
                textareaRef.current?.focus();
              }
            }}
          >
            <EmojiPicker
              compact
              query={typeahead.query}
              searchRef={dropdownRef}
              onSelect={pickTypeahead}
            />
          </div>
        </div>
      )}

      {(attachments?.length ?? 0) > 0 && (
        <div className={cn('flex flex-wrap gap-2 pb-1', compact ? 'px-3' : 'px-4')}>
          {attachments!.map((attachment) => (
            <div key={attachment.id} className="group/att relative">
              <img src={attachment.previewUrl} alt="" className="size-16 rounded-sm border object-cover" />
              {onRemoveAttachment && (
                <button
                  type="button"
                  aria-label="remove attachment"
                  className="text-foreground bg-background absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-sm border opacity-0 transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100"
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className={cn(
        'flex items-center justify-between gap-2 transition-opacity duration-200',
        variant === 'edit' ? '' : 'opacity-0 group-focus-within:opacity-100',
        compact ? 'px-2 py-1' : 'px-3 py-2',
      )}>
        <div className="flex items-center gap-1">
          {onAddFiles && (
            <label
              className="text-muted-foreground hover:text-foreground ml-1 flex size-8 cursor-pointer items-center justify-center rounded-sm"
              aria-label="attach images"
            >
              <Paperclip className="size-4" />
              <input
                type="file"
                accept={UPLOADABLE_IMAGE_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) onAddFiles(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {(onAddFiles || variant === 'edit') && (
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="add emoji"
                  className="text-muted-foreground hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-sm"
                >
                  <Smile className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <EmojiPicker onSelect={insertEmoji} />
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="flex items-center gap-2">
          {variant === 'edit' && (
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel} className="h-8">
              cancel
            </Button>
          )}
          <Button
            type="button"
            variant="privacy"
            disabled={!canSubmit}
            onClick={onSubmit}
            className={cn(PRIVACY_BUTTON, PRIVACY[grade].className, 'border border-input')}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
