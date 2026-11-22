import { listOf } from "@/lib/text/list";

import type { MaterialRequestLine } from "./contracts";

/** What names a line: its type and size, else the technician's words. */
export type NamedLine = Pick<MaterialRequestLine, "product_type" | "dimension" | "original_text">;

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * How a line is named outside its row, on screen and in what the server answers: its type and size, else the
 * technician's words. A line carries no number on screen: a sentence that points at one names it by what it asks.
 */
export function lineTitle(line: NamedLine): string {
  const type = text(line.product_type);
  if (type) return [type, text(line.dimension)].filter(Boolean).join(" ");
  const original = text(line.original_text);
  return original ? `« ${original} »` : "Sans désignation";
}

/**
 * Lines named in a sentence: « A », « A et B », « A, B et C »; beyond three, « A, B, C et 4 autres », so that a long
 * request stays one sentence.
 */
export function lineNamesLabel(names: readonly string[]): string {
  if (names.length <= 3) return listOf(names);
  const others = names.length - 3;
  return `${names.slice(0, 3).join(", ")} et ${others} ${others > 1 ? "autres" : "autre"}`;
}

/** The order of the request, the id settling two lines of the same rank. */
export function byPosition(left: Pick<MaterialRequestLine, "id" | "position">, right: Pick<MaterialRequestLine, "id" | "position">): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}

/**
 * How a sentence starts when it names lines: « La ligne A », « Les lignes A, B et C » (`capital: false` inside a
 * sentence). The verb that follows agrees with `names.length`.
 */
export function linesSubject(names: readonly string[], { capital = true }: { capital?: boolean } = {}): string {
  const subject = names.length === 1 ? `a ligne ${names[0]}` : `es lignes ${lineNamesLabel(names)}`;
  return `${capital ? "L" : "l"}${subject}`;
}
