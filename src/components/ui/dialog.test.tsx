import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, SmoothDialogContent, DialogTitle } from './dialog';

/** Swaps between a short and a tall pane, like tabs do. */
const Harness = () => {
  const [tall, setTall] = useState(false);
  return (
    <Dialog open onOpenChange={() => undefined}>
      <SmoothDialogContent>
        <DialogTitle>probe</DialogTitle>
        <button type="button" onClick={() => setTall((value) => !value)}>swap</button>
        {tall ? <p>TALLCONTENT</p> : <p>short</p>}
      </SmoothDialogContent>
    </Dialog>
  );
};

const frame = (): HTMLElement =>
  document.querySelector('[data-slot="smooth-dialog-frame"]')!;

describe('SmoothDialogContent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('grows and shrinks with content — tab swaps animate both ways', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.textContent?.includes('TALLCONTENT') ? 500 : 200;
    });

    render(<Harness />);

    expect(frame().style.height).toBe('200px');

    fireEvent.click(screen.getByRole('button', { name: 'swap' }));
    expect(frame().style.height).toBe('500px');

    // back to the short pane: the frame follows it back down
    fireEvent.click(screen.getByRole('button', { name: 'swap' }));
    expect(frame().style.height).toBe('200px');
  });

  it('honours minHeight as the floor when content is shorter', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100);

    render(
      <Dialog open onOpenChange={() => undefined}>
        <SmoothDialogContent minHeight={460}>
          <DialogTitle>probe</DialogTitle>
          <p>short</p>
        </SmoothDialogContent>
      </Dialog>,
    );

    expect(frame().style.height).toBe('460px');
  });
});
