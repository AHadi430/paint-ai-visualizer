import type {
  IdentifyResult,
  PaletteColor,
  Photo,
  Shade,
  Stroke,
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

/** Current mask image of a surface (a new URL after every edit). */
export const maskUrlFor = (imageId: string, surfaceId: string) =>
  freshUrl(`/api/visualizer/mask/${imageId}_${surfaceId}.png`);

/**
 * Render the photo with every painted surface. `variant` keeps
 * separate results per colour scheme ("a", "b", "c").
 */
export function renderPaint(
  imageId: string,
  surfaces: { surface_id: string; color: string }[],
  variant?: string
) {
  return post<{ image_url: string }>('/api/visualizer/recolor', {
    image_id: imageId,
    surfaces,
    variant,
  });
}

export type DetectedSurface = {
  id: string;
  type: string;
  score: number;
  mask_url: string;
  box: number[];
};

/** Find the walls, ceiling and other paintable surfaces in a photo. */
export async function detectSurfaces(imageId: string) {
  const data = await post<{ surfaces: DetectedSurface[] }>(
    '/api/visualizer/analyze',
    { image_id: imageId }
  );

  return data.surfaces;
}

const strokesBody = (strokes: Stroke[]) =>
  strokes.map((stroke) => ({
    points: stroke.points.map((point) => [point.x, point.y]),
    width: stroke.width,
  }));

/** Add or remove brushed areas from a surface, or undo the last edit. */
export function editSurface(
  imageId: string,
  surfaceId: string,
  action: 'add' | 'remove' | 'undo',
  strokes: Stroke[] = []
) {
  return post<{ mask_url: string; can_undo: boolean }>(
    '/api/visualizer/edit-mask',
    {
      image_id: imageId,
      surface_id: surfaceId,
      action,
      strokes: strokesBody(strokes),
    }
  );
}

/**
 * Remove wires, poles, vehicles and clutter (auto) and/or brushed
 * areas. Returns the cleaned photo, a new image.
 */
export async function cleanUpPhoto(
  imageId: string,
  auto: boolean,
  strokes: Stroke[] = []
) {
  const data = await post<{
    image_id: string;
    image_url: string;
    removed: string[];
  }>('/api/visualizer/clean', {
    image_id: imageId,
    auto,
    strokes: strokesBody(strokes),
  });

  return {
    photo: { id: data.image_id, url: apiUrl(data.image_url) } as Photo,
    removed: data.removed,
  };
}

/** Copy surface masks to another version of the same photo. */
export function transferSurfaces(fromImageId: string, toImageId: string) {
  return post<{ copied: number }>('/api/visualizer/transfer-surfaces', {
    from_image_id: fromImageId,
    to_image_id: toImageId,
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
