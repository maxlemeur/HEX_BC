// Where the lines of a text sit around its anchor. The plotted PDF and the
// view share it, so that both write a text at the same place.

import type { CadText } from "./model";

/** Capital height of Helvetica, for a font size of 1. */
export const CAD_CAP_HEIGHT = 0.718;
/** From one baseline to the next, in capital heights. */
export const CAD_LINE_SPACING = 5 / 3;

export function cadTextLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** How far the baseline of the first line is above the anchor, in drawing units, for a text of `lines` lines. */
export function cadFirstBaseline(entry: Pick<CadText, "height" | "baseline">, lines: number): number {
  const step = entry.height * CAD_LINE_SPACING, block = entry.height + (lines - 1) * step;
  return entry.baseline === 3 ? -entry.height : entry.baseline === 2 ? block / 2 - entry.height : entry.baseline === 1 ? (lines - 1) * step : 0;
}

const NARROW = " !'\".,:;|()[]{}/\\-ijlftrI°*`", WIDE = "mMW%@";
const NARROW_WIDTH = 0.39, LETTER_WIDTH = 0.76, CAPITAL_WIDTH = 0.95, WIDE_WIDTH = 1.2;

/** Width of a line over its capital height, close to Helvetica's: what a paragraph is wrapped with, before any font is at hand. */
export function cadLineWidth(line: string): number {
  let width = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    width += NARROW.includes(char) ? NARROW_WIDTH : WIDE.includes(char) ? WIDE_WIDTH : (char >= "A" && char <= "Z") || (char >= "À" && char <= "Þ") ? CAPITAL_WIDTH : LETTER_WIDTH;
  }
  return width;
}

/**
 * Breaks the lines of a paragraph at their spaces so that none is wider than `width` capital heights, as the rectangle
 * of a paragraph does. A word wider than the rectangle stays whole on its line; without a width, nothing moves.
 */
export function cadWrap(text: string, width: number): string {
  if (!(width > 0) || !Number.isFinite(width)) return text;
  return text.split("\n").map((line) => {
    if (cadLineWidth(line) <= width) return line;
    const lines: string[] = [];
    let current = "", used = 0, started = false, worded = false;
    for (const word of line.split(" ")) {
      const wide = cadLineWidth(word);
      if (word !== "" && worded && used + NARROW_WIDTH + wide > width) {
        lines.push(current.trimEnd());
        current = word; used = wide;
      } else {
        current = started ? `${current} ${word}` : word;
        used += (started ? NARROW_WIDTH : 0) + wide;
      }
      started = true;
      if (word !== "") worded = true;
    }
    lines.push(current.trimEnd());
    return lines.join("\n");
  }).join("\n");
}
