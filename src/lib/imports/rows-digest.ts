import { createHash } from "node:crypto";

import { asRecord } from "@/lib/value-guards";

/** The facts of a mapped row that its confirmation's proof covers, in this order. */
export const DPGF_ROW_FACTS = ["designation", "reference", "hex_code", "unit", "quantity", "notes"] as const;

/** The structure facts of a row's raw row (_timax_structure) the estimate's normaliser reads, in this order. */
export const DPGF_ROW_STRUCTURE_FACTS = [
  "sheet_name", "source_row_number", "bold_columns", "merged_columns", "outline_level", "column_order",
] as const;

export type DigestedImportRow = { raw_row_id?: string | null; status?: string | null; payload: unknown };

/**
 * A number in its one canonical form: a plain decimal without trailing zeros, never an exponent (1e-7 is 0.0000001,
 * 1e21 is 1000000000000000000000, -0 is 0), as the database writes it after trim_scale (where 1.50 is 1.5).
 */
function plainDecimal(value: number) {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = "", exponent] = match;
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  const plain = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${sign}${plain}`;
}

function scalarText(value: unknown) {
  return value === null || value === undefined ? "z"
    : typeof value === "string" ? `s${value}`
      : typeof value === "number" ? `n${plainDecimal(value)}`
        : typeof value === "boolean" ? `b${String(value)}`
          : "j";
}

const prefixed = (text: string) => `${Buffer.byteLength(text, "utf8")}:${text}`;

/**
 * One fact, typed and prefixed by its length in UTF-8 bytes: no separator can be confused with a value. A list (the
 * structure's columns) is its elements' facts in order; an object, or a list inside a list, digests as its type alone,
 * as in the database.
 */
function factText(value: unknown) {
  return prefixed(Array.isArray(value) ? `l${value.map((entry) => prefixed(scalarText(entry))).join("")}` : scalarText(value));
}

/** UTF-8 byte order, the database's « C » collation. */
const byBytes = (left: string, right: string) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

/**
 * The digest of what a confirmation uses of an import's rows: every mapped row the estimate's normaliser receives,
 * whatever its status, by its raw row, with its index, the facts the proof covers (read from the mapped row, else from
 * the payload's top level, the shape older mapping writers stored) and its raw row's structure facts. The preview
 * computes it where it presents the rows, the confirmation compares it with the rows it builds from, and the database
 * computes the same digest under the confirmation's lock (private.dpgf_import_rows_sha256): any difference refuses the
 * confirmation.
 */
export function dpgfImportRowsDigest(rows: ReadonlyArray<DigestedImportRow>) {
  const lines = rows
    .map(({ raw_row_id: rawRowId, payload }) => {
      const record = asRecord(payload) ?? {};
      const mapped = asRecord(record.mapped_row);
      const structure = asRecord(asRecord(record.raw_row)?._timax_structure);
      const facts = [
        factText(record.row_index),
        ...DPGF_ROW_FACTS.map((key) => factText(mapped && Object.hasOwn(mapped, key) ? mapped[key] : record[key])),
        ...DPGF_ROW_STRUCTURE_FACTS.map((key) => factText(structure?.[key])),
      ];
      const key = rawRowId ?? "";
      return { key, line: `${key}${facts.join("")}` };
    })
    .sort((left, right) => byBytes(left.key, right.key) || byBytes(left.line, right.line));
  return createHash("sha256").update(lines.map(({ line }) => line).join("\n"), "utf8").digest("hex");
}
