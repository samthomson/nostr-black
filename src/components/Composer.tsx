import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { PRIVACY, PRIVACY_BUTTON, type PrivacyGrade } from '@/lib/privacy';
import { cn } from '@/lib/utils';

type ComposerVariant = 'public' | 'private';

const COMPOSER: Record<ComposerVariant, { placeholder: string; ariaLabel: string; grade: PrivacyGrade; card: string }> = {
  public: {
    placeholder: "what's happening?",
    ariaLabel: "what's happening?",
    grade: 'public',
    card: 'bg-privacy-public text-privacy-private',
  },
  private: {
    placeholder: 'what are you doing?',
    ariaLabel: 'what are you doing?',
    grade: 'private',
    card: 'bg-privacy-private text-privacy-public',
  },
};

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  variant: ComposerVariant;
};

/**
 * The write-and-broadcast bar shared by the public and private feeds.
 * Presentational only: the caller owns the draft and the submit action.
 * The card carries the privacy grade (public = white, private = black);
 * the textarea starts short, grows with content to a cap, then scrolls;
 * the footer (broadcast button) fades in on focus without shifting layout.
 */
export const Composer = ({ value, onChange, onSubmit, variant }: ComposerProps) => {
  const { placeholder, ariaLabel, grade, card } = COMPOSER[variant];
  const canSubmit = value.trim().length > 0;
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
      'group rounded-md border border-input shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
      card,
    )}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
        className="block min-h-12 max-h-40 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-3 text-sm outline-none transition-[height] duration-200 ease-out placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) onSubmit();
        }}
      />
      <div className="flex items-center justify-end gap-2 px-3 py-2 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100">
        <Button
          type="button"
          variant="privacy"
          disabled={!canSubmit}
          onClick={onSubmit}
          className={cn(PRIVACY_BUTTON, PRIVACY[grade].className, 'border border-input')}
        >
          broadcast
        </Button>
      </div>
    </div>
  );
};
