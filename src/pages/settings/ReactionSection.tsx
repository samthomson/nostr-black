import { useAppContext } from '@/hooks/useAppContext';
import { EMOJI_CHOICES } from '@/lib/engagementKinds';
import { Section } from './Section';

/** The default reaction: what a plain heart-click broadcasts. Hold the
 * heart on any note to pick something else per-note. */
export const ReactionSection = () => {
  const { config, updateConfig } = useAppContext();

  return (
    <Section title="default reaction" hint="what a plain heart-click broadcasts">
      <div className="flex flex-wrap gap-1">
        {EMOJI_CHOICES.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-pressed={config.defaultReaction === emoji}
            onClick={() => updateConfig((current) => ({ ...current, defaultReaction: emoji }))}
            className={`cursor-pointer rounded-sm px-2.5 py-1 text-base hover:bg-accent ${
              config.defaultReaction === emoji ? 'bg-foreground/10 ring-1 ring-foreground/40' : ''
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        hold a note's heart to pick a different emoji for that one reaction
      </p>
    </Section>
  );
};
