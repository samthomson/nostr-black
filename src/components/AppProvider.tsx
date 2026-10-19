import { ReactNode, useCallback, useEffect, useMemo } from 'react';
import { z } from 'zod';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { AppContext, type AppConfig, type Theme } from '@/contexts/AppContext';

interface AppProviderProps {
  children: ReactNode;
  /** Application storage key */
  storageKey: string;
  /** Default app configuration */
  defaultConfig: AppConfig;
}

/** The pre-six-slot preset row, for folding stored configs forward. */
const LEGACY_REACTION_PRESETS = ['+', '❤', '😂', '🙏', '🔥', '👏', '😭', '🤔'];
const AppConfigSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  discoveryRelays: z.array(z.url()),
  torEnabled: z.boolean(),
  mediaEnabled: z.boolean(),
  imageCompression: z.boolean(),
  feedKinds: z.array(z.number()),
  mediaCacheMaxMb: z.number(),
  mediaMaxDownloadMb: z.number(),
  defaultReaction: z.string(),
  reactionChoices: z.array(z.string()).length(6),
  clientTag: z.object({
    mode: z.enum(['none', 'black', 'spoof']),
    spoof: z.array(z.string()),
  }),
}) satisfies z.ZodType<AppConfig>;

export function AppProvider(props: AppProviderProps) {
  const {
    children,
    storageKey,
    defaultConfig,
  } = props;

  // App configuration state with localStorage persistence
  const [rawConfig, setConfig] = useLocalStorage<Partial<AppConfig>>(
    storageKey,
    {},
    {
      serialize: JSON.stringify,
      deserialize: (value: string) => {
        const parsed = JSON.parse(value);
        return AppConfigSchema.partial().parse(parsed);
      }
    }
  );

  // Generic config updater with callback pattern. useCallback is load-bearing:
  // consumers (NostrSync) key effects on this identity — a new identity per
  // render turns them into a query loop.
  const updateConfig = useCallback(
    (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => {
      setConfig(updater);
    },
    []
  );

  const config = useMemo(() => {
    const merged = { ...defaultConfig, ...rawConfig };
    // One-shot migration: a stored config predates reactionChoices, so
    // its old eight presets and a custom defaultReaction need folding
    // into the new six slots (custom default first, old presets after).
    if (!rawConfig.reactionChoices && 'reactionChoices' in defaultConfig) {
      const legacy: string[] = rawConfig.defaultReaction
        ? [rawConfig.defaultReaction, ...LEGACY_REACTION_PRESETS]
        : [...LEGACY_REACTION_PRESETS];
      merged.reactionChoices = [...new Set(legacy)].slice(0, 6);
    }
    return merged;
  }, [defaultConfig, rawConfig]);

  // Runtime, non-persisted: when the last NIP-65 discovery attempt finished.

  const appContextValue = useMemo(
    () => ({ config, updateConfig }),
    [config, updateConfig]
  );
  // Apply theme effects to document
  useApplyTheme(config.theme);

  return (
    <AppContext.Provider value={appContextValue}>
      {children}
    </AppContext.Provider>
  );
}

/**
 * Hook to apply theme changes to the document root
 */
function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light';

      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  // Handle system theme changes when theme is set to "system"
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      const root = window.document.documentElement;
      root.classList.remove('light', 'dark');

      const systemTheme = mediaQuery.matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
}