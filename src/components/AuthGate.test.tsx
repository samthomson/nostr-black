import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { TestApp } from '@/test/TestApp';
import { AuthGate } from '@/components/AuthGate';

describe('AuthGate', () => {
  it('redirects logged-out visitors on gated routes to the landing', async () => {
    window.history.pushState({}, '', '/private');
    render(
      <TestApp>
        <Routes>
          <Route path="/" element={<div>landing</div>} />
          <Route
            path="/private"
            element={
              <AuthGate>
                <div>secret</div>
              </AuthGate>
            }
          />
        </Routes>
      </TestApp>,
    );

    expect(await screen.findByText('landing')).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.queryByText(/session key required/)).toBeNull();
  });
});
