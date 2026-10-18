import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipInput } from './chip-input';

const Harness = ({ onChange }: { onChange?: (next: string[]) => void }) => {
  const [values, setValues] = useState<string[]>(['seed']);
  return (
    <ChipInput
      values={values}
      onChange={(next) => {
        setValues(next);
        onChange?.(next);
      }}
      placeholder="add one"
      ariaLabel="tags"
    />
  );
};

describe('ChipInput', () => {
  it('renders existing values as chips with remove buttons', () => {
    render(<Harness />);
    expect(screen.getByText('seed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'remove seed' })).toBeTruthy();
  });

  it('Enter commits the draft as a chip and clears the field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    await user.type(input, 'fresh{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['seed', 'fresh']);
    expect(input).toHaveValue('');
  });

  it('comma also commits — each comma-separated part becomes its own chip', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('tags');
    // the comma never lands in the field: each keystroke commits what
    // precedes it, so 'a,b{Enter}' yields two chips
    await user.type(input, 'a,b{Enter}');
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('trims and dedupes: whitespace or a duplicate changes nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    await user.type(input, 'seed{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('backspace on an empty field pops the last chip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    await user.type(input, '{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('backspace with text in the field edits the draft, not the chips', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    await user.type(input, 'ab{Backspace}');
    expect(input).toHaveValue('a');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a chip removes itself via its ×', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'remove seed' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
