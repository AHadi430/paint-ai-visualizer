/*
 * Surface masks are black/white PNGs the size of the photo. They are
 * decoded once, at screen resolution, and used to test taps and to
 * draw highlights.
 */

/**
 * Masks are decoded at most this size. The photo is shown much
 * smaller than its real size on a phone, so full resolution only
 * costs time (decoding, scanning and encoding ~4x more pixels).
 */
const MAX_SIDE = 800;

type Mask = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Mask pixels per photo pixel. */
  scale: number;
};

const masks = new Map<string, Promise<Mask>>();

export function loadMask(url: string): Promise<Mask> {
  const cached = masks.get(url);

  if (cached) {
    return cached;
  }

  const promise = new Promise<Mask>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      const scale = Math.min(
        1,
        MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight)
      );

      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (!context) {
        reject(new Error('Canvas is not available.'));
        return;
      }

      context.drawImage(image, 0, 0, width, height);

      resolve({
        data: context.getImageData(0, 0, width, height).data,
        width,
        height,
        scale,
      });
    };

    image.onerror = () => reject(new Error('Could not load the mask.'));
    image.src = url;
  });

  masks.set(url, promise);

  // Allow a retry if loading failed.
  promise.catch(() => masks.delete(url));

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

    const px = Math.min(mask.width - 1, Math.max(0, Math.floor(x * mask.scale)));
    const py = Math.min(mask.height - 1, Math.max(0, Math.floor(y * mask.scale)));

    return mask.data[(py * mask.width + px) * 4] > 127;
  } catch {
    return false;
  }
}

/** Fraction of mask A that lies inside mask B (0 when either fails). */
export async function maskOverlap(urlA: string, urlB: string): Promise<number> {
  try {
    const [a, b] = await Promise.all([loadMask(urlA), loadMask(urlB)]);

    if (a.width !== b.width || a.height !== b.height) {
      return 0;
    }

    let inA = 0;
    let both = 0;

    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i] > 127) {
        inA++;
        if (b.data[i] > 127) {
          both++;
        }
      }
    }

    return inA ? both / inA : 0;
  } catch {
    return 0;
  }
}

// Finished highlight images, reused when the same wall (or set of
// walls) is shown again. Oldest are dropped beyond the limit.
const highlights = new Map<string, Promise<string>>();
const MAX_HIGHLIGHTS = 24;

/**
 * A translucent tint over one or more surfaces with a white outline,
 * as an object URL. Results are cached: don't revoke them.
 */
export function highlightUrl(
  urls: string | string[],
  color: [number, number, number] = [47, 128, 237],
  fillAlpha = 95
): Promise<string> {
  const list = Array.isArray(urls) ? urls : [urls];
  const key = `${list.join('|')}#${color.join(',')}#${fillAlpha}`;

  const cached = highlights.get(key);

  if (cached) {
    // Most recently used goes last.
    highlights.delete(key);
    highlights.set(key, cached);
    return cached;
  }

  const promise = drawHighlight(list, color, fillAlpha);
  highlights.set(key, promise);
  promise.catch(() => highlights.delete(key));

  while (highlights.size > MAX_HIGHLIGHTS) {
    const [oldKey, oldUrl] = highlights.entries().next().value!;
    highlights.delete(oldKey);
    oldUrl.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }

  return promise;
}

async function drawHighlight(
  urls: string[],
  color: [number, number, number],
  fillAlpha: number
): Promise<string> {
  const loaded = await Promise.all(urls.map(loadMask));
  const { width, height } = loaded[0];

  const out = new ImageData(width, height);
  const pixels = out.data;

  // Outline thickness, visible when the photo is shown on a phone.
  const edge = Math.max(1, Math.round(Math.max(width, height) / 280));

  for (const mask of loaded) {
    if (mask.width !== width || mask.height !== height) {
      continue;
    }

    const data = mask.data;

    const inside = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4] > 127;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        if (data[i] <= 127) {
          continue;
        }

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
        } else if (pixels[i + 3] === 0) {
          pixels[i] = color[0];
          pixels[i + 1] = color[1];
          pixels[i + 2] = color[2];
          pixels[i + 3] = fillAlpha;
        }
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
