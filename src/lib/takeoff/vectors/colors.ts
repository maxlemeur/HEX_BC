// Stroke colours of the vector reading (TI-662). pdfjs gives every colour
// space as #rrggbb (setStrokeRGBColor) and a pattern as « pattern ».
// - Near-white (« quasi-blanc »): lightness ≥ 0.75 and saturation < 0.25, or
//   lightness ≥ 0.93 whatever the hue. The architecture background of the
//   bench plans carries 2 to 49 % of the stroke length in such colours
//   (spike of 3/11/2026). Near-white strokes never count in the detection
//   badge, and are never classified as a network.
// - Grey (saturation < 0.1): the background also uses mid greys; a grey group
//   is never classified as a network by keyword (no legend draws a network in
//   grey on the bench plans), it stays for Decisions or the user.

export const NEAR_WHITE = { lightness: 0.75, saturation: 0.25, whiteLightness: 0.93 } as const;
export const GREY_SATURATION = 0.1;

export type Rgb = { r: number; g: number; b: number };

export function parseHexColor(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** HSL lightness and saturation in [0, 1]. */
export function lightnessSaturation(rgb: Rgb) {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return { lightness, saturation: 0 };
  const saturation = lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { lightness, saturation };
}

export function isNearWhite(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return false;
  const { lightness, saturation } = lightnessSaturation(rgb);
  return lightness >= NEAR_WHITE.whiteLightness || (lightness >= NEAR_WHITE.lightness && saturation < NEAR_WHITE.saturation);
}

export function isGrey(color: string) {
  const rgb = parseHexColor(color);
  return rgb !== null && lightnessSaturation(rgb).saturation < GREY_SATURATION;
}
