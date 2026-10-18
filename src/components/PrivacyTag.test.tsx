import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PrivacyTag } from './PrivacyTag';

describe('PrivacyTag', () => {
  it('renders a single grade with its grade label', () => {
    render(<PrivacyTag grade="private" />);
    expect(screen.getByText('private')).toBeInTheDocument();
  });

  it('renders custom children over the default label', () => {
    render(<PrivacyTag grade="public">feed</PrivacyTag>);
    expect(screen.getByText('feed')).toBeInTheDocument();
  });

  it('renders a mixed pair with the mixed label', () => {
    render(<PrivacyTag grade={['public', 'private']} />);
    expect(screen.getByText('mixed')).toBeInTheDocument();
  });

  it('splits a mixed pair diagonally corner to corner between the two grade colours', () => {
    const { container } = render(<PrivacyTag grade={['public', 'private']} />);
    const tag = container.firstElementChild as HTMLElement;
    expect(tag.style.backgroundImage).toBe(
      'linear-gradient(to bottom right, var(--privacy-public) 49.6%, var(--privacy-public) 50.4%, var(--privacy-private) 49.6%, var(--privacy-private) 50.4%)',
    );
  });

  it('carries the diagonal split inverted on the text so glyphs read on both halves', () => {
    const { container } = render(<PrivacyTag grade={['public', 'private']} />);
    const tag = container.firstElementChild as HTMLElement;
    const text = tag.firstElementChild as HTMLElement;
    expect(text.className).toContain('bg-clip-text');
    expect(text.style.backgroundImage).toBe(
      'linear-gradient(to bottom right, var(--privacy-public-fg) 49.6%, var(--privacy-public-fg) 50.4%, var(--privacy-private-fg) 49.6%, var(--privacy-private-fg) 50.4%)',
    );
  });

  it('keeps custom className on the tag itself', () => {
    const { container } = render(<PrivacyTag grade={['low', 'high']} className="ml-1" />);
    expect(container.firstElementChild?.className).toContain('ml-1');
  });
});
