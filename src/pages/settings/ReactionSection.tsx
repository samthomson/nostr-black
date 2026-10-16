import { useAppContext } from '@/hooks/useAppContext';
import { EMOJI_CHOICES } from '@/lib/engagementKinds';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Section } from './Section';

/** The default reaction: what a plain heart-click broadcasts. Hold the
 * heart on any note to pick something else per-note. */
export const ReactionSection = () => {
  const { config, updateConfig } = useAppContext();

  return (
    <Section title="default reaction" hint="what a plain heart-click broadcasts">
      <div className="flex flex-wrap gap-1">
        {EMOJI_CHOICES.map((emoji) => (
          <Button
            key={emoji}
            variant="ghost"
            size="sm"
            aria-pressed={config.defaultReaction === emoji}
            onClick={() => updateConfig((current) => ({ ...current, defaultReaction: emoji }))}
            className={cn(
              'text-base',
              config.defaultReaction === emoji && 'bg-foreground/10 ring-1 ring-foreground/40',
            )}
          >
            {emoji}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        hold a note's heart to pick a different emoji for that one reaction
      </p>
    </Section>
  );
};
