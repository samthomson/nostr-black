import { describe, expect, it } from 'vitest';
import { clipMiddle } from './format';

describe('clipMiddle', () => {
  const npub = 'npub1ndfe8ev3wtw63yw37n5v9ctt4ga9ujj0a5k68n6sdh0dum64rjgqkufxll';

  it('keeps both ends of a long npub identifiable', () => {
    expect(clipMiddle(npub)).toBe('npub1ndfe8…ufxll');
  });

  it('passes through strings short enough to fit', () => {
    expect(clipMiddle('npub1ndfe8…')).toBe('npub1ndfe8…');
  });

  it('honours custom head/tail lengths', () => {
    expect(clipMiddle('abcdefghijklmnop', 4, 3)).toBe('abcd…nop');
  });

  it('never mangles strings exactly at the boundary', () => {
    // head + tail + 1 chars fit without an ellipsis; one more gets clipped
    expect(clipMiddle('abcdefghijklmnop', 8, 7)).toBe('abcdefghijklmnop');
    expect(clipMiddle('abcdefghijklmnopq', 8, 7)).toBe('abcdefgh…klmnopq');
  });
});
