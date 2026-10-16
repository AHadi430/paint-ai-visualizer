import type {
  IdentifyResult,
  PaletteColor,
  Photo,
  Shade,
} from './types';

/*
 * Backend location. Empty means "same origin": in development Vite
 * forwards /api to the backend (see vite.config.ts).
 */
const API = import.meta.env.VITE_API_URL ?? '';

export const apiUrl = (path: string) => `${API}${path}`;

/** A fresh URL for an image that the backend may have rewritten. */
export const freshUrl = (path: string) =>
  `${apiUrl(path)}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;

async function readJson(res: Response) {
  const text = await res.text();

  let data: { detail?: string } & Record<string, unknown> = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      [502, 503, 504].includes(res.status)
        ? 'The server is starting up. Please try again in a moment.'
        : `Something went wrong (${res.status}). Please try again.`
    );
  }

  if (!res.ok) {
    throw new Error(data.detail || 'Something went wrong. Please try again.');
  }

  return data;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;

  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }

  return (await readJson(res)) as T;
}

export async function getShades(): Promise<Shade[]> {
  const res = await fetch(apiUrl('/api/visualizer/shades'));
  const data = await readJson(res);

  return (data.shades as Shade[]) ?? [];
}

export async function uploadPhoto(file: File): Promise<Photo> {
  const form = new FormData();
  form.append('file', file);

  let res: Response;

  try {
    res = await fetch(apiUrl('/api/visualizer/upload'), {
      method: 'POST',
      body: form,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }

  const data = await readJson(res);

  return {
    id: data.image_id as string,
    url: apiUrl(data.image_url as string),
  };
}

/** Find the wall/surface under a tap (SAM). */
export function findSurface(
  imageId: string,
  x: number,
  y: number,
  surfaceId: string
) {
  return post<{ mask_url: string }>('/api/visualizer/segment', {
    image_id: imageId,
    x,
    y,
    surface_id: surfaceId,
    surface_type: 'wall',
  });
}

/** Render the photo with every painted surface. */
export function renderPaint(
  imageId: string,
  surfaces: { surface_id: string; color: string }[]
) {
  return post<{ image_url: string }>('/api/visualizer/recolor', {
    image_id: imageId,
    surfaces,
  });
}

export function identifyColor(
  imageId: string,
  x: number,
  y: number,
  mode: 'surface' | 'point'
) {
  return post<IdentifyResult>('/api/visualizer/identify-color', {
    image_id: imageId,
    x,
    y,
    mode,
  });
}

export async function getPalette(imageId: string) {
  const data = await post<{ colors: PaletteColor[] }>(
    '/api/visualizer/palette',
    { image_id: imageId }
  );

  return data.colors;
}
