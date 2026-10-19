import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BroadcastDialog } from '@/components/BroadcastDialog';

const base = {
  open: true,
  onOpenChange: () => {},
  grade: 'public' as const,
  label: 'note',
  layers: [],
  identityPubkey: 'a'.repeat(64),
  onRepreview: () => {},
  onBroadcast: () => {},
};

/** The relay switches, in row order. */
const relaySwitches = (): HTMLElement[] =>
  screen.getAllByRole('switch').filter((el) => (el.getAttribute('aria-label') ?? '').startsWith('toggle '));

const toggleHost = async (user: { click: (el: Element) => Promise<void> }, host: string): Promise<void> => {
  const pill = relaySwitches().find((el) => el.getAttribute('aria-label') === `toggle ${host}`);
  if (!pill) throw new Error(`no relay pill for ${host}`);
  await user.click(pill);
};

describe('BroadcastDialog relays row', () => {
  it('dedupes a relay named by both the plan and the discovery set', () => {
    render(
      <BroadcastDialog
        {...base}
        relays={['wss://mine/', 'wss://shared/']}
        extraRelays={['wss://shared/', 'wss://disc/']}
      />,
    );
    expect(relaySwitches().map((el) => el.getAttribute('aria-label'))).toEqual([
      'toggle mine',
      'toggle shared',
      'toggle disc',
    ]);
  });

  it('starts discovery relays off and ours on, and the broadcast uses exactly the on set', async () => {
    const onBroadcast = vi.fn();
    const user = userEvent.setup();
    render(
      <BroadcastDialog
        {...base}
        onBroadcast={onBroadcast}
        relays={['wss://mine/']}
        extraRelays={['wss://disc/']}
      />,
    );
    expect(
      relaySwitches().map((el) => el.getAttribute('aria-checked')),
    ).toEqual(['true', 'false']);

    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    expect(onBroadcast).toHaveBeenCalledWith(['wss://mine/']);
  });

  it('toggling a relay off drops it from the broadcast', async () => {
    const onBroadcast = vi.fn();
    const user = userEvent.setup();
    render(
      <BroadcastDialog
        {...base}
        onBroadcast={onBroadcast}
        relays={['wss://mine/', 'wss://extra/']}
      />,
    );

    await toggleHost(user, 'extra');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    expect(onBroadcast).toHaveBeenCalledWith(['wss://mine/']);
  });

  it('toggling a discovery relay on adds it to the broadcast', async () => {
    const onBroadcast = vi.fn();
    const user = userEvent.setup();
    render(
      <BroadcastDialog
        {...base}
        onBroadcast={onBroadcast}
        relays={['wss://mine/']}
        extraRelays={['wss://disc/']}
      />,
    );

    await toggleHost(user, 'disc');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    expect(onBroadcast).toHaveBeenCalledWith(['wss://mine/', 'wss://disc/']);
  });

  it('toggling everything off broadcasts nothing', async () => {
    const onBroadcast = vi.fn();
    const user = userEvent.setup();
    render(
      <BroadcastDialog
        {...base}
        onBroadcast={onBroadcast}
        relays={['wss://mine/']}
      />,
    );

    await toggleHost(user, 'mine');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    expect(onBroadcast).toHaveBeenCalledWith([]);
  });

  it('toggling twice returns a relay to its original state', async () => {
    const onBroadcast = vi.fn();
    const user = userEvent.setup();
    render(
      <BroadcastDialog
        {...base}
        onBroadcast={onBroadcast}
        relays={['wss://mine/']}
      />,
    );

    await toggleHost(user, 'mine');
    await toggleHost(user, 'mine');
    await user.click(screen.getByRole('button', { name: 'broadcast' }));
    expect(onBroadcast).toHaveBeenCalledWith(['wss://mine/']);
  });
});
