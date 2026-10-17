import { describe, expect, it } from 'vitest';
import { anchorSpacerHeight } from './anchorSpacer';

describe('anchorSpacerHeight', () => {
  it('is zero when enough content already sits below the card', () => {
    // Card 1000px down, 2000px of content, 600px viewport: pinning needs
    // 1000 - 56 + 600 = 1544 ≤ 2000 — nothing to add.
    expect(anchorSpacerHeight(1000, 2000, 600, 56)).toBe(0);
  });

  it('is exactly the deficit when the card is the last item', () => {
    // Card top at 1000, content ends at 1200, viewport 600: natural max
    // scroll is 600, the pin needs scrollTop 944 — short by 344.
    expect(anchorSpacerHeight(1000, 1200, 600, 56)).toBe(344);
  });

  it('never returns negative, even for a card above its destination', () => {
    // Card already at the very top: no deficit to make up.
    expect(anchorSpacerHeight(8, 4000, 600, 56)).toBe(0);
  });

  it('scales with viewport: a taller column needs more room below', () => {
    const short = anchorSpacerHeight(1000, 1200, 600, 56);
    const tall = anchorSpacerHeight(1000, 1200, 900, 56);
    expect(tall - short).toBe(300);
  });

  it('is zero when the content exactly reaches the pin position', () => {
    // Boundary: cardTop - topOffset + viewport === naturalHeight.
    expect(anchorSpacerHeight(1056, 1600, 600, 56)).toBe(0);
  });
});
