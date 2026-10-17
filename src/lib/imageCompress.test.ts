import { describe, expect, it } from 'vitest';
import { MAX_EDGE, MIN_COMPRESS_BYTES, compressImage, scaledSize } from './imageCompress';

const file = (bytes: number, type: string): File =>
  new File([new Uint8Array(bytes)], 'a.img', { type });

describe('scaledSize', () => {
  it('downscales by the longest edge, preserving aspect', () => {
    expect(scaledSize(3840, 2160, MAX_EDGE)).toEqual({ width: MAX_EDGE, height: 1080 });
    expect(scaledSize(2160, 3840, MAX_EDGE)).toEqual({ width: 1080, height: MAX_EDGE });
  });

  it('never upscales and survives zero dimensions', () => {
    expect(scaledSize(800, 600, MAX_EDGE)).toEqual({ width: 800, height: 600 });
    expect(scaledSize(0, 0, MAX_EDGE)).toEqual({ width: 0, height: 0 });
  });
});

describe('compressImage', () => {
  it('passes gifs through untouched — re-encoding kills animation', async () => {
    const gif = file(MIN_COMPRESS_BYTES + 1, 'image/gif');
    const out = await compressImage(gif);
    expect(out.type).toBe('image/gif');
    expect(out.width).toBe(0);
  });

  it('passes non-images and small files through', async () => {
    expect((await compressImage(file(MIN_COMPRESS_BYTES + 1, 'text/plain'))).type).toBe('text/plain');
    expect((await compressImage(file(10, 'image/png'))).type).toBe('image/png');
  });

  it('falls back to the original when the browser cannot decode it', async () => {
    // jsdom has no createImageBitmap — the same failure any broken file hits.
    const out = await compressImage(file(MIN_COMPRESS_BYTES + 1, 'image/png'));
    expect(out.type).toBe('image/png');
  });
});
