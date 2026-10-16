import { useLayoutEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRIVACY, PRIVACY_BUTTON, type PrivacyGrade } from '@/lib/privacy';
import { cn } from '@/lib/utils';

type ComposerVariant = 'post' | 'reply' | 'edit';

/**
 * The one text-input surface for notes, in three shapes:
 *  - post: a feed's top composer (placeholder asks the grade's question)
 *  - reply: the thread composer under an opened note (enter submits)
 *  - edit: the inline editor for a note you own (prefilled, save/cancel)
 * The card wears the privacy grade of what you're writing (public =
 * white, private = black); the textarea grows with content to a cap, then
 * scrolls. Presentational only — the caller owns the draft and actions.
 */
export const Composer = ({
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  variant,
  grade,
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
}) => {
  const placeholder =
    variant === 'post' ? (grade === 'private' ? 'what are you doing?' : "what's happening?")
    : variant === 'reply' ? 'reply…'
    : 'edit note';
  const submitLabel = variant === 'edit' ? 'save' : variant === 'reply' ? 'reply' : 'broadcast';
  const canSubmit = value.trim().length > 0 && !busy;
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
        className="block min-h-12 max-h-40 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-3 text-sm outline-none transition-[height] duration-200 ease-out placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || variant === 'reply') && canSubmit) onSubmit();
        }}
      />
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 transition-opacity duration-200',
        variant === 'post' ? 'justify-end opacity-0 group-focus-within:opacity-100' : 'justify-end',
      )}>
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
  );
};
