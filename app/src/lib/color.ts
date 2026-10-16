/** Black or white, whichever is easier to read on `hex`. */
export function readableOn(hex: string): string {
  const value = hex.replace('#', '');

  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  return luminance > 0.36 ? '#171717' : '#ffffff';
}
