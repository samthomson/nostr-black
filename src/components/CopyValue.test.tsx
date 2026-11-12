import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CopyValue } from './CopyValue';

const writeText = vi.fn().mockResolvedValue(undefined);

describe('CopyValue', () => {
  it('copies the value on click and flips to a check for a beat', async () => {
    vi.useFakeTimers();
    try {
      Object.assign(navigator, { clipboard: { writeText } });
      render(<CopyValue value="abc123">abc123</CopyValue>);

      const button = screen.getByRole('button', { name: 'copy value' });
      await act(async () => { fireEvent.click(button); });

      expect(writeText).toHaveBeenCalledWith('abc123');
      expect(button.className).toContain('text-copper');

      act(() => { vi.advanceTimersByTime(1300); });
      expect(button.className).not.toContain('text-copper');
    } finally {
      vi.useRealTimers();
    }
  });
});
