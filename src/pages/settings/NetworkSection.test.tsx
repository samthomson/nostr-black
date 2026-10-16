import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestApp } from '@/test/TestApp';
import { NetworkSection } from './NetworkSection';
import { useAppContext } from '@/hooks/useAppContext';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';

/** Expose the live config so the test can read what was persisted. */
const Probe = () => {
  const { config } = useAppContext();
  return <span data-testid="discovery">{config.discoveryRelays.join(',')}</span>;
};

/** The discovery editor's add-row — second in the DOM, after the NIP-65 list. */
const discoveryEditor = async () => {
  const input = (await screen.findAllByPlaceholderText('wss://relay.example.com'))[1]!;
  const add = screen.getAllByRole('button', { name: 'add' })[1]!;
  return { input, add };
};

describe('NetworkSection discovery relays', () => {
  it('adds a relay through the row editor and persists it on save', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <NetworkSection />
        <Probe />
      </TestApp>,
    );

    expect(screen.getByTestId('discovery')).toHaveTextContent(DEFAULT_DISCOVERY_RELAYS.join(','));

    const { input, add } = await discoveryEditor();
    await user.type(input, 'wss://extra.example.com');
    await user.click(add);

    // In the working copy but not persisted until save.
    expect(await screen.findByText('wss://extra.example.com/')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(screen.getByTestId('discovery')).toHaveTextContent(
      `${DEFAULT_DISCOVERY_RELAYS.join(',')},wss://extra.example.com/`,
    );
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
  });

  it('discard reverts the working copy to the saved list', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <NetworkSection />
        <Probe />
      </TestApp>,
    );

    const { input, add } = await discoveryEditor();
    await user.type(input, 'wss://temp.example.com');
    await user.click(add);
    await user.click(screen.getByRole('button', { name: 'discard' }));

    expect(screen.queryByText('wss://temp.example.com/')).toBeNull();
    expect(screen.getByTestId('discovery')).toHaveTextContent(DEFAULT_DISCOVERY_RELAYS.join(','));
  });
});
