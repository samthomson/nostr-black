import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivacySection } from './PrivacySection';
import { TestApp } from '@/test/TestApp';

/** The section's own radio group — scoped so the media checkbox above
 * never collides with queries. */
const section = () => screen.getByText('client tag').closest('section')!;

beforeEach(() => {
  window.localStorage.removeItem('test-app-config');
});

describe('ClientTagSection', () => {
  it('defaults to no client tag', () => {
    render(<TestApp><PrivacySection /></TestApp>);
    const radios = section().querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios[0]).toBeChecked(); // none
    expect(radios[0]).toHaveAccessibleName(/no client tag/);
  });

  it('switches modes by radio', async () => {
    const user = userEvent.setup();
    render(<TestApp><PrivacySection /></TestApp>);
    const radios = () => section().querySelectorAll<HTMLInputElement>('input[type="radio"]');
    await user.click(radios()[1]!); // nostr black
    expect(radios()[1]).toBeChecked();
  });

  it('spoof mode reveals the chip input; Enter adds a chip that persists', async () => {
    const user = userEvent.setup();
    render(<TestApp><PrivacySection /></TestApp>);
    const radios = () => section().querySelectorAll<HTMLInputElement>('input[type="radio"]');
    await user.click(radios()[2]!); // spoof to…

    const input = section().querySelector<HTMLInputElement>('input[aria-label="spoof client name"]')!;
    await user.type(input, 'Gossip{Enter}');
    expect(section().textContent).toContain('Gossip');

    // the choice persists through a remount (localStorage-backed config):
    // render again into the same container and query the second section
    render(<TestApp><PrivacySection /></TestApp>);
    const sections = screen.getAllByText('client tag');
    const remounted = sections.at(-1)!.closest('section')!;
    expect(remounted.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2]).toBeChecked();
    expect(remounted.textContent).toContain('Gossip');
  });

  it('dedupes and trims: re-adding or whitespace-only input changes nothing', async () => {
    window.localStorage.setItem('test-app-config', JSON.stringify({
      clientTag: { mode: 'spoof', spoof: ['Damus'] },
    }));
    const user = userEvent.setup();
    render(<TestApp><PrivacySection /></TestApp>);
    const input = section().querySelector<HTMLInputElement>('input[aria-label="spoof client name"]')!;
    await user.type(input, '  Damus  {Enter}');
    expect(section().querySelectorAll('[data-slot="chip-input"] > span')).toHaveLength(1);
    expect(input).toHaveValue('');
  });

  it('backspace on an empty field pops the last chip', async () => {
    window.localStorage.setItem('test-app-config', JSON.stringify({
      clientTag: { mode: 'spoof', spoof: ['Damus', 'Primal'] },
    }));
    const user = userEvent.setup();
    render(<TestApp><PrivacySection /></TestApp>);
    const input = section().querySelector<HTMLInputElement>('input[aria-label="spoof client name"]')!;
    await user.type(input, '{Backspace}');
    // Primal (the last chip) is gone and returns to the suggestions; Damus stays
    expect(section().textContent).toContain('+ Primal');
    expect(section().querySelectorAll('[data-slot="chip-input"] > span')).toHaveLength(1);
    expect(section().textContent).not.toContain('+ Damus');
  });

  it('preseeds suggestions from the common clients and skips pool members', async () => {
    window.localStorage.setItem('test-app-config', JSON.stringify({
      clientTag: { mode: 'spoof', spoof: ['Damus'] },
    }));
    render(<TestApp><PrivacySection /></TestApp>);
    const text = section().textContent!;
    expect(text).toContain('Primal');
    // Damus is already in the pool as a pill, so it is not offered again
    expect(section().textContent!.match(/\+ Damus/g)).toBeNull();
    expect(section().textContent).toContain('+ Primal');
  });

  it('pills are removable', async () => {
    window.localStorage.setItem('test-app-config', JSON.stringify({
      clientTag: { mode: 'spoof', spoof: ['Damus', 'Primal'] },
    }));
    const user = userEvent.setup();
    render(<TestApp><PrivacySection /></TestApp>);
    await user.click(screen.getByRole('button', { name: 'remove Damus' }));
    expect(section().textContent).toContain('Primal');
    expect(section().textContent).not.toContain('remove Damus');
  });
});
