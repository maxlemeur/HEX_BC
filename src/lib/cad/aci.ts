// AutoCAD Color Index (group code 62) to 0xRRGGBB. The first nine colours and
// the six greys are fixed; 10 to 249 follow a wheel of 24 hues, each with five
// shades and a pale variant of every shade.

const FIXED = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x414141, 0x808080];
const GREYS = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff];
const SHADES = [255, 189, 129, 104, 79];

function hueChannel(hue: number, offset: number): number {
  // HSV with full saturation and value, one channel.
  const k = (offset + hue / 60) % 6;
  return 1 - Math.max(0, Math.min(k, 4 - k, 1));
}

/** Colour of an ACI index (1 to 255); white for anything else. */
export function aciColor(index: number): number {
  if (!Number.isInteger(index) || index < 1 || index > 255) return 0xffffff;
  if (index < 10) return FIXED[index];
  if (index >= 250) return GREYS[index - 250];
  const hue = Math.floor((index - 10) / 10) * 15;
  const step = (index - 10) % 10;
  const shade = SHADES[Math.floor(step / 2)];
  const pale = step % 2 === 1;
  let color = 0;
  for (const offset of [5, 3, 1]) {
    const base = Math.floor(255 * hueChannel(hue, offset) + 1e-9);
    const tinted = pale ? Math.round(base + ((255 - base) * 2) / 3) : base;
    color = (color << 8) | Math.round((tinted * shade) / 255);
  }
  return color >>> 0;
}
