/**
 * Image compression for uploads: decode, downscale, re-encode — pure
 * browser APIs (createImageBitmap + an offscreen canvas), no network.
 *
 * Policy: GIFs and non-images pass through untouched (re-encoding a GIF
 * kills its animation), files already smaller than MIN_COMPRESS_BYTES
 * pass through (re-encoding can only churn), and a re-encode that came
 * out bigger than the original is discarded in favour of the original.
 */

/** Longest edge a kept image may have; larger images are downscaled. */
export const MAX_EDGE = 1920;
/** Re-encode quality (WebP, and JPEG where WebP is unavailable). */
export const QUALITY = 0.85;
/** Files below this size are not worth a decode/encode round-trip. */
export const MIN_COMPRESS_BYTES = 64 * 1024;

export interface CompressedImage {
  bytes: Uint8Array;
  /** MIME type of `bytes` — the original's on pass-through. */
  type: string;
  /** Pixel size of the image as uploaded (post-downscale). */
  width: number;
  height: number;
}

/** The size an image scales to under `maxEdge`, preserving aspect and
 * never upscaling. Exported for the tests; callers use compressImage. */
export const scaledSize = (width: number, height: number, maxEdge: number): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

const toBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob | null> => {
  const { promise, resolve } = Promise.withResolvers<Blob | null>();
  canvas.toBlob(resolve, type, QUALITY);
  return promise;
};

/** One staged upload: compressed if the file benefits from it, the
 * original bytes otherwise. Never throws for an image the browser can't
 * decode — the original passes through. */
export const compressImage = async (file: File): Promise<CompressedImage> => {
  const passthrough = async (width = 0, height = 0): Promise<CompressedImage> => ({
    bytes: new Uint8Array(await file.arrayBuffer()),
    type: file.type || 'application/octet-stream',
    width,
    height,
  });

  if (!file.type.startsWith('image/') || file.type === 'image/gif') return passthrough();
  if (file.size < MIN_COMPRESS_BYTES) return passthrough();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return passthrough();
  }

  const { width, height } = scaledSize(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return passthrough(bitmap.width, bitmap.height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  bitmap.close();

  // WebP first; engines without it silently fall back to PNG — detect
  // that and treat it as no-encode rather than shipping a PNG.
  const encoded = await toBlob(canvas, 'image/webp');
  if (!encoded || encoded.type !== 'image/webp') return passthrough(originalWidth, originalHeight);
  if (encoded.size >= file.size) return passthrough(originalWidth, originalHeight);
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), type: encoded.type, width, height };
};
