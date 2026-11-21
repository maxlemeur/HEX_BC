import { createHash } from "node:crypto";

import { asRecord } from "@/lib/value-guards";

/** The facts of a mapped row that its confirmation's proof covers, in this order. */
export const DPGF_ROW_FACTS = ["designation", "reference", "hex_code", "unit", "quantity", "notes"] as const;

export type DigestedImportRow = { raw_row_id?: string | null; status?: string | null; payload: unknown };

/**
 * A number as the database writes a JSON number (numeric text): a plain decimal, never an exponent (1e-7 is 0.0000001,
 * 1e21 is 1000000000000000000000), so that a formula residue in a quantity cell digests alike on both sides.
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

/**
 * One fact, typed and prefixed by its length in UTF-8 bytes: no separator can be confused with a value. An object or
 * an array (no writer stores one as a mapped fact) digests as its type alone, as in the database.
 */
function factText(value: unknown) {
  const text = value === null || value === undefined ? "z"
    : typeof value === "string" ? `s${value}`
      : typeof value === "number" ? `n${plainDecimal(value)}`
        : typeof value === "boolean" ? `b${String(value)}`
          : "j";
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

/** UTF-8 byte order, the database's « C » collation. */
const byBytes = (left: string, right: string) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

/**
 * The digest of what a member reviews of an import's rows before confirming it: for each mapped row, by its raw row,
 * the facts the confirmation's proof covers, read from the mapped row, else from the payload's top level (the shape
 * older mapping writers stored). The preview computes it where it presents the rows, the confirmation compares it with
 * the rows it builds from, and the database computes the same digest under the confirmation's lock
 * (private.dpgf_import_rows_sha256): any difference refuses the confirmation.
 */
export function dpgfImportRowsDigest(rows: ReadonlyArray<DigestedImportRow>) {
  const lines = rows
    .filter(({ status }) => status === undefined || status === null || status === "mapped")
    .map(({ raw_row_id: rawRowId, payload }) => {
      const record = asRecord(payload) ?? {};
      const mapped = asRecord(record.mapped_row);
      const facts = DPGF_ROW_FACTS.map((key) => factText(mapped && Object.hasOwn(mapped, key) ? mapped[key] : record[key]));
      const key = rawRowId ?? "";
      return { key, line: `${key}${facts.join("")}` };
    })
    .sort((left, right) => byBytes(left.key, right.key) || byBytes(left.line, right.line));
  return createHash("sha256").update(lines.map(({ line }) => line).join("\n"), "utf8").digest("hex");
}
