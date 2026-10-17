import { useLayoutEffect, useRef } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRIVACY, PRIVACY_BUTTON, type PrivacyGrade } from '@/lib/privacy';
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
 * attachments and their upload.
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
      variant === 'edit'
        ? 'bg-transparent'
        : grade === 'private'
          ? 'bg-privacy-private text-privacy-public'
          : 'bg-privacy-public text-privacy-private',
    )}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={1}
        className={cn(
          'block w-full resize-none overflow-y-auto border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          compact
            ? 'max-h-24 min-h-8 px-3 py-1.5'
            : 'max-h-40 min-h-12 px-4 py-3 transition-[height] duration-200 ease-out',
        )}
        onPaste={(e) => {
          if (!onAddFiles) return;
          const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
          if (images.length === 0) return;
          e.preventDefault();
          onAddFiles(images);
        }}
        onKeyDown={(e) => {
          // Shift+Enter is a plain newline, always — the universal
          // "don't submit" pattern. Plain Enter submits only in the
          // reply composer; elsewhere it needs meta/ctrl.
          if (e.key !== 'Enter' || e.shiftKey) return;
          if ((e.metaKey || e.ctrlKey || variant === 'reply') && canSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />

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
        'flex items-center gap-2 transition-opacity duration-200',
        variant === 'edit' ? '' : 'opacity-0 group-focus-within:opacity-100',
        compact ? 'px-2 py-1' : 'px-3 py-2',
        onAddFiles ? 'justify-between' : 'justify-end',
      )}>
        {onAddFiles && (
          <label
            className="text-muted-foreground hover:text-foreground ml-1 flex size-8 cursor-pointer items-center justify-center rounded-sm"
            aria-label="attach images"
          >
            <Paperclip className="size-4" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onAddFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
          </label>
        )}
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
