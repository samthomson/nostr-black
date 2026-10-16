import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditHistoryDialog } from './EditHistoryDialog';
import type { Rumor } from '@/lib/feedEncryption';

const rumor = (content: string, at: number): Rumor => ({
  id: `id-${at}`,
  pubkey: 'pk',
  created_at: at,
  kind: 1,
  tags: [],
  content,
});

describe('EditHistoryDialog', () => {
  it('lays a single-line edit out side by side, not as repeated lines', () => {
    render(
      <EditHistoryDialog
        versions={[rumor('hello world', 1), rumor('hallo world', 2)]}
        open
        onOpenChange={() => {}}
      />,
    );
    const grid = screen.getByTestId('diff-grid');
    // one row, two columns — old left, new right
    expect(grid.children).toHaveLength(2);
    expect(grid.textContent).toContain('hello world');
    expect(grid.textContent).toContain('hallo world');
  });

  it('keeps unchanged lines as context on both sides of a multi-line edit', () => {
    render(
      <EditHistoryDialog
        versions={[
          rumor('line one\nline two\nline three', 1),
          rumor('line one\nline TWO\nline three', 2),
        ]}
        open
        onOpenChange={() => {}}
      />,
    );
    const grid = screen.getByTestId('diff-grid');
    // three rows × two columns
    expect(grid.children).toHaveLength(6);
    expect(grid.textContent).toContain('line one');
    expect(grid.textContent).toContain('line two');
    expect(grid.textContent).toContain('line TWO');
    expect(grid.textContent).toContain('line three');
  });
});
