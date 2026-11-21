import { createHash } from "node:crypto";

import { asRecord } from "@/lib/value-guards";

/** The facts of a mapped row that its confirmation's proof covers, in this order. */
export const DPGF_ROW_FACTS = ["designation", "reference", "hex_code", "unit", "quantity", "notes"] as const;

export type DigestedImportRow = { raw_row_id?: string | null; status?: string | null; payload: unknown };

/** One fact, typed and prefixed by its length in UTF-8 bytes: no separator can be confused with a value. */
function factText(value: unknown) {
  const text = value === null || value === undefined ? "z"
    : typeof value === "string" ? `s${value}`
      : typeof value === "number" ? `n${String(value)}`
        : typeof value === "boolean" ? `b${String(value)}`
          : `j${JSON.stringify(value)}`;
  return `${Buffer.byteLength(text, "utf8")}:${text}`;
}

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
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1
      : left.line < right.line ? -1 : left.line > right.line ? 1 : 0));
  return createHash("sha256").update(lines.map(({ line }) => line).join("\n"), "utf8").digest("hex");
}
