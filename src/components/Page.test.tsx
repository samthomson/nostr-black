import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { Page } from '@/components/Page';

describe('Page', () => {
  it('renders body without a title when title is omitted', () => {
    render(
      <TestApp>
        <Page>
          <p>feed body</p>
        </Page>
      </TestApp>,
    );
    expect(screen.getByText('feed body')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('renders title JSX and nav', () => {
    render(
      <TestApp>
        <Page
          title={<>settings <span>tag</span></>}
          nav={<nav aria-label="sections">tabs</nav>}
        >
          <p>panel</p>
        </Page>
      </TestApp>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('settings tag');
    expect(screen.getByRole('navigation', { name: 'sections' })).toHaveTextContent('tabs');
    expect(screen.getByText('panel')).toBeTruthy();
  });
});
