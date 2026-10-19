import { SmilePlus } from 'lucide-react';
import { useAppContext } from '@/hooks/useAppContext';
import { ChipInput } from '@/components/ui/chip-input';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Section } from './Section';

const MAX_REACTIONS = 6;

/** Reaction presets as a chips input: each chip is one long-press choice;
 * × removes it, the picker (or typing an emoji + Enter) adds one — up to
 * six. The ringed chip is what a plain heart-click broadcasts; click a
 * chip to make it the default. */
export const ReactionSection = () => {
  const { config, updateConfig } = useAppContext();

  const setChoices = (reactionChoices: string[]) =>
    updateConfig((current) => ({ ...current, reactionChoices }));

  return (
    <Section title="reactions" hint="up to six; click one to set your default">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72">
          <ChipInput
            values={config.reactionChoices}
            onChange={(next) => setChoices(next.slice(0, MAX_REACTIONS))}
            placeholder="paste or type an emoji"
            ariaLabel="reaction emoji"
            max={MAX_REACTIONS}
            selected={config.defaultReaction}
            onChipClick={(emoji) =>
              updateConfig((current) => ({ ...current, defaultReaction: emoji }))
            }
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={config.reactionChoices.length >= MAX_REACTIONS}
              aria-label="add emoji"
            >
              <SmilePlus className="size-4" />
              add emoji
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <EmojiPicker
              onSelect={(emoji) => {
                if (!config.reactionChoices.includes(emoji)) {
                  setChoices([...config.reactionChoices, emoji].slice(0, MAX_REACTIONS));
                }
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-muted-foreground text-xs">
        what a plain heart-click broadcasts — hold a note's heart to pick from these
      </p>
    </Section>
  );
};
