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
