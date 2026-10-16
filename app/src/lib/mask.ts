/*
 * Surface masks are black/white PNGs the size of the photo. They are
 * decoded once and used to test taps and to draw highlights.
 */

const cache = new Map<string, Promise<ImageData>>();

export function loadMask(url: string): Promise<ImageData> {
  const cached = cache.get(url);

  if (cached) {
    return cached;
  }

  const promise = new Promise<ImageData>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) {
        reject(new Error('Canvas is not available.'));
        return;
      }

      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, canvas.width, canvas.height));
    };

    image.onerror = () => reject(new Error('Could not load the mask.'));
    image.src = url;
  });

  cache.set(url, promise);

  // Allow a retry if loading failed.
  promise.catch(() => cache.delete(url));

  return promise;
}

/** Is the photo pixel (x, y) inside the mask? */
export async function maskContains(
  url: string,
  x: number,
  y: number
): Promise<boolean> {
  try {
    const mask = await loadMask(url);

    const px = Math.min(mask.width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(mask.height - 1, Math.max(0, Math.floor(y)));

    return mask.data[(py * mask.width + px) * 4] > 127;
  } catch {
    return false;
  }
}

/**
 * A translucent tint over the surface with a white outline, as an
 * object URL (revoke it when no longer shown).
 */
export async function highlightUrl(
  url: string,
  color: [number, number, number] = [47, 128, 237],
  fillAlpha = 95
): Promise<string> {
  const mask = await loadMask(url);
  const { width, height, data } = mask;

  const out = new ImageData(width, height);
  const pixels = out.data;

  // Outline thickness in photo pixels, so it stays visible when the
  // photo is shown small on a phone.
  const edge = Math.max(2, Math.round(Math.max(width, height) / 300));

  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height &&
    data[(y * width + x) * 4] > 127;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) {
        continue;
      }

      const i = (y * width + x) * 4;

      const border =
        !inside(x - edge, y) ||
        !inside(x + edge, y) ||
        !inside(x, y - edge) ||
        !inside(x, y + edge);

      if (border) {
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = 235;
      } else {
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = fillAlpha;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.putImageData(out, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );

  if (!blob) {
    throw new Error('Could not draw the highlight.');
  }

  return URL.createObjectURL(blob);
}
