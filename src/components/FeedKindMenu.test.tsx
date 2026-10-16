import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestApp } from '@/test/TestApp';
import { FeedKindMenu } from './FeedKindMenu';
import { useAppContext } from '@/hooks/useAppContext';

/** Expose the live config so the test can read what was persisted. */
const Probe = () => {
  const { config } = useAppContext();
  return <span data-testid="kinds">{config.feedKinds.join(',')}</span>;
};

describe('FeedKindMenu', () => {
  it('keeps earlier toggles when unchecking several kinds in a row', async () => {
    const user = userEvent.setup();
    render(
      <TestApp>
        <FeedKindMenu />
        <Probe />
      </TestApp>,
    );

    expect(screen.getByTestId('kinds')).toHaveTextContent('1,6,16,20,21,1063,30023');

    await user.click(screen.getByRole('button', { name: 'feed kinds' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /kind 6/ }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /kind 20/ }));

    // Both stay off; kind 6 must not reappear after kind 20 is toggled.
    expect(screen.getByTestId('kinds')).toHaveTextContent('1,16,21,1063,30023');
  });
});
