export type Shade = {
  code: string;
  name: string;
  hex: string;
  category: string;
};

export type Photo = {
  id: string;
  url: string;
};

/** A position in the photo, in original image pixels. */
export type Point = {
  x: number;
  y: number;
};

export type ShadeMatch = Shade & {
  /** CIEDE2000 difference: under 2 is a near-perfect match. */
  delta_e: number;
  match: string;
};

export type ColorReport = {
  hex: string;
  rgb: number[];
  name: string;
  family: string;
  temperature: string;
  lightness: string;
  matches: ShadeMatch[];
};

export type IdentifyResult = ColorReport & {
  mode: 'surface' | 'point';
  mask_url: string | null;
  coverage: number;
  uneven_lighting: boolean;
};

export type PaletteColor = ColorReport & {
  /** Fraction of the photo this colour covers. */
  share: number;
};

export type Wall = {
  id: string;
  maskUrl: string;
  shade?: Shade;
};
