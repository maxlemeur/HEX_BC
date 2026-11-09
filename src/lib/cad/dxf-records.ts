// A DXF file is a list of pairs, a group code on one line and its value on the
// next. A pair of code 0 opens a record (a section, a table entry, an entity),
// which runs to the next code 0.

import type { CadUnits } from "./model";

export function num(value: string | undefined): number {
  if (value === undefined) return 0;
  // "Infinity" and "NaN" are no numbers of a drawing: they read as 0, like any other word.
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  const lenient = Number.parseFloat(value);
  return Number.isFinite(lenient) ? lenient : 0;
}

export class DxfRecords {
  /** Type of the current record, upper case. */
  type = "";
  codes: number[] = [];
  values: string[] = [];
  /** Pairs of the current record (the arrays are reused and may be longer). */
  count = 0;
  /** « 0 EOF » was read: the file is whole. */
  ended = false;
  private at = 0;
  private code = -1;
  private value = "";
  private ahead = false;

  constructor(private readonly text: string) {
    // Comments (999) may come before the first section.
    while (this.advance() && this.code === 999);
    this.ahead = this.code === 0;
  }

  /** Type of the first record without consuming it, null when the text is not made of DXF pairs. */
  peekType(): string | null {
    return this.ahead ? this.value.trim().toUpperCase() : null;
  }

  private advance(): boolean {
    const text = this.text;
    let end = text.indexOf("\n", this.at);
    if (end < 0) return false;
    const line = text.slice(this.at, end);
    const code = Number(line);
    // A blank or non-numeric code line is not a pair: the reading stops here.
    if (!Number.isInteger(code) || line.trim() === "") { this.code = -1; return false; }
    const from = end + 1;
    if (from >= text.length) return false;
    end = text.indexOf("\n", from);
    let value: string;
    if (end < 0) { value = text.slice(from); this.at = text.length; } else { value = text.slice(from, end); this.at = end + 1; }
    if (value.charCodeAt(value.length - 1) === 13) value = value.slice(0, -1);
    this.code = code;
    this.value = value;
    return true;
  }

  /** Moves to the next record. False at the end of the file; a record cut by the end is dropped. */
  next(): boolean {
    if (!this.ahead) return false;
    this.type = this.value.trim().toUpperCase();
    this.count = 0;
    if (this.type === "EOF") { this.ended = true; this.ahead = false; return false; }
    for (;;) {
      if (!this.advance()) { this.ahead = false; return false; }
      if (this.code === 0) return true;
      this.codes[this.count] = this.code;
      this.values[this.count] = this.value;
      this.count += 1;
    }
  }

  /** First value of a group code in the current record. */
  first(code: number): string | undefined {
    for (let index = 0; index < this.count; index += 1) if (this.codes[index] === code) return this.values[index];
    return undefined;
  }
}

/** Format codes of AutoCAD files (DXF « $ACADVER », first bytes of a DWG) and the release that introduced each. */
export const ACAD_VERSIONS: Record<string, string> = {
  AC1006: "AutoCAD R10", AC1009: "AutoCAD R11/R12", AC1012: "AutoCAD R13", AC1014: "AutoCAD R14", AC1015: "AutoCAD 2000",
  AC1018: "AutoCAD 2004", AC1021: "AutoCAD 2007", AC1024: "AutoCAD 2010", AC1027: "AutoCAD 2013", AC1032: "AutoCAD 2018",
};

/** $INSUNITS: metres per drawing unit and the name shown to the user. */
const UNITS: Record<number, [number, string]> = {
  1: [0.0254, "pouce"], 2: [0.3048, "pied"], 3: [1609.344, "mile"], 4: [0.001, "millimètre"], 5: [0.01, "centimètre"], 6: [1, "mètre"],
  7: [1000, "kilomètre"], 10: [0.9144, "yard"], 13: [0.000001, "micromètre"], 14: [0.1, "décimètre"], 15: [10, "décamètre"], 16: [100, "hectomètre"],
};

export const NO_UNITS: CadUnits = { code: 0, metresPerUnit: null, name: "sans unité" };

export type DxfHeader = { version: { code: string; label: string }; units: CadUnits };

/** Reads the variables of the HEADER section, held by the current « SECTION » record. */
export function readHeader(records: DxfRecords): DxfHeader {
  let variable = "", code = "", units: CadUnits = { ...NO_UNITS };
  for (let index = 0; index < records.count; index += 1) {
    const group = records.codes[index], value = records.values[index].trim();
    if (group === 9) variable = value.toUpperCase();
    else if (variable === "$ACADVER" && group === 1) code = value.toUpperCase();
    else if (variable === "$INSUNITS" && group === 70) {
      const known = UNITS[num(value)];
      units = known ? { code: num(value), metresPerUnit: known[0], name: known[1] } : { ...NO_UNITS };
    }
  }
  return { version: { code, label: ACAD_VERSIONS[code] ?? (code === "" ? "version inconnue" : code) }, units };
}
