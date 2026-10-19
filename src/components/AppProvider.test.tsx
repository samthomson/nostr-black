import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppProvider } from './AppProvider';
import { useAppContext } from '@/hooks/useAppContext';

function Probe() {
  const { config } = useAppContext();
  return <div data-testid="choices">{config.reactionChoices.join(',')}</div>;
}

describe('AppProvider reactionChoices migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('a stored config predating reactionChoices folds old presets into six slots, custom default first', () => {
    window.localStorage.setItem('nostr:app-config/2', JSON.stringify({ defaultReaction: '🤙' }));
    render(
      <AppProvider storageKey="nostr:app-config/2" defaultConfig={{
        theme: 'dark',
        discoveryRelays: [],
        torEnabled: true,
        mediaEnabled: true,
        imageCompression: true,
        feedKinds: [],
        mediaCacheMaxMb: 1,
        mediaMaxDownloadMb: 1,
        defaultReaction: '+',
        reactionChoices: ['+', '❤', '😂', '🙏', '🔥', '👏'],
        clientTag: { mode: 'none', spoof: [] },
      }}>
        <Probe />
      </AppProvider>,
    );
    const choices = screen.getByTestId('choices').textContent!.split(',');
    // custom default takes the first slot; old presets follow; still six, deduped
    expect(choices[0]).toBe('🤙');
    expect(choices).toHaveLength(6);
    expect(new Set(choices).size).toBe(6);
  });

  it('a stored config already carrying reactionChoices passes through untouched', () => {
    window.localStorage.setItem('nostr:app-config/2', JSON.stringify({
      defaultReaction: '🔥',
      reactionChoices: ['🔥', 'x', 'y', 'z', 'w', 'v'],
    }));
    render(
      <AppProvider storageKey="nostr:app-config/2" defaultConfig={{
        theme: 'dark',
        discoveryRelays: [],
        torEnabled: true,
        mediaEnabled: true,
        imageCompression: true,
        feedKinds: [],
        mediaCacheMaxMb: 1,
        mediaMaxDownloadMb: 1,
        defaultReaction: '+',
        reactionChoices: ['+', '❤', '😂', '🙏', '🔥', '👏'],
        clientTag: { mode: 'none', spoof: [] },
      }}>
        <Probe />
      </AppProvider>,
    );
    expect(screen.getByTestId('choices').textContent).toBe('🔥,x,y,z,w,v');
  });
});
