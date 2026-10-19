import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Chip input — type, Enter or comma adds a chip; Backspace on an empty
 * field pops the last one; each chip removes itself via its ×. Values
 * are trimmed and deduped by the caller's `values` array (the component
 * never mutates it). Clicking anywhere focuses the field.
 *
 * With `max`, additions beyond the cap are rejected. With `selected` +
 * `onChipClick`, the marked chip is ringed and clicking a chip reports
 * it (reactions: "make this the default").
 */
export function ChipInput({
  values,
  onChange,
  placeholder,
  ariaLabel,
  className,
  max,
  selected,
  onChipClick,
}: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  max?: number;
  selected?: string;
  onChipClick?: (value: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const atMax = max !== undefined && values.length >= max;

  const commit = () => {
    const value = draft.trim();
    if (!value || values.includes(value) || atMax) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <div
      data-slot="chip-input"
      className={cn(
        'flex w-full flex-wrap items-center gap-1 rounded-sm border border-input bg-transparent p-1 shadow-xs transition-[color,box-shadow] outline-none',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        className,
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          e.currentTarget.querySelector('input')?.focus();
        }
      }}
    >
      {values.map((value) => (
        <span
          key={value}
          className={cn(
            'flex items-center gap-0.5 rounded-sm bg-foreground/8 px-1.5 py-0.5 text-base leading-none',
            selected === value && 'ring-1 ring-foreground/40',
            onChipClick && 'cursor-pointer',
          )}
          onClick={onChipClick ? () => onChipClick(value) : undefined}
        >
          {value}
          <button
            type="button"
            aria-label={`remove ${value}`}
            onClick={(e) => {
              // the chip itself may be clickable (make-default) —
              // removal must not also trigger that
              e.stopPropagation();
              onChange(values.filter((v) => v !== value));
            }}
            className="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {!atMax && (
        <input
          className="w-16 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder={values.length === 0 ? placeholder : undefined}
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Backspace' && draft === '' && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      )}
    </div>
  );
}
