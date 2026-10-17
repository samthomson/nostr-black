import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionStatus } from './ConnectionStatus';
import { TestApp } from '@/test/TestApp';
import { egressLog, logQuery, logQueryDone, resetEgressSession } from '@/net/net';

beforeEach(() => {
  egressLog.length = 0;
  resetEgressSession();
});

afterEach(() => {
  egressLog.length = 0;
  resetEgressSession();
});

describe('ConnectionStatus', () => {
  it('opens blocked relays on click, not hover', async () => {
    const entry = logQuery('wss://gated.example/', [1]);
    entry.status = 'auth';
    entry.reason = 'relay requires auth (not logged in)';
    logQueryDone(entry, 0, 12);
    expect(egressLog.some((e) => e.status === 'auth')).toBe(true);

    render(
      <TestApp>
        <ConnectionStatus />
      </TestApp>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /blocked/ }));
    expect(await screen.findByText(/gated.example/)).toBeTruthy();
    expect(screen.getByText(/relay requires auth/)).toBeTruthy();
  });
});
