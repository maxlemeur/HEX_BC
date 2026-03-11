import {
  attachImportRowProvenance,
  type ImportRowProvenance,
} from "@/lib/imports/payload";
import type { NormalizedImportRow } from "@/lib/imports/parser";

type JsonRecord = Record<string, unknown>;

export type TabularPdfReviewState =
  | "light_validation"
  | "reinforced_validation"
  | "manual_required";

export type TabularPdfTableDecision = "approve" | "review" | "reject";

export type TabularPdfTableIssueCode =
  | "missing_headers"
  | "duplicate_headers"
  | "empty_table"
  | "sparse_rows"
  | "row_width_mismatch";

export type TabularPdfTableIssue = {
  code: TabularPdfTableIssueCode;
  severity: "warning" | "error";
  message: string;
};

export type TabularPdfReviewTable = {
  source_page: number;
  table_index: number;
  title: string | null;
  headers: string[];
  row_count: number;
  sample_rows: string[][];
  decision: TabularPdfTableDecision;
  issues: TabularPdfTableIssue[];
};

export type TabularPdfImportReview = {
  review_state: TabularPdfReviewState;
  import_filename: string | null;
  source_file_name: string | null;
  source_document_id: string | null;
  summary: {
    total_tables: number;
    approvable_tables: number;
    rejected_tables: number;
    total_rows: number;
    approvable_rows: number;
  };
  suggested_approved_tables: Array<{
    sourcePage: number;
    tableIndex: number;
  }>;
  tables: TabularPdfReviewTable[];
};

export type TabularPdfDetectedRow = {
  row_index: number;
  cells: string[];
};

export type TabularPdfDetectedTable = {
  source_page: number;
  table_index: number;
  title: string | null;
  headers: string[];
  rows: TabularPdfDetectedRow[];
};

type TabularPdfDefaults = {
  source_file_name: string | null;
  source_document_id: string | null;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parsePositiveInteger(value: unknown, fieldPath: string, minimum = 1) {
  const parsed = parseInteger(value);
  if (parsed === null || parsed < minimum) {
    const comparator = minimum === 0 ? ">= 0" : ">= 1";
    throw new Error(`${fieldPath} invalide. Utiliser un entier ${comparator}.`);
  }

  return parsed;
}

function normalizeHeader(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value).trim();
  }

  return value.trim();
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return String(value).trim();
}

function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>();

  return headers.map((header, index) => {
    const base =
      header.trim().length > 0 ? header.trim() : `column_${index + 1}`;
    const currentCount = counts.get(base) ?? 0;
    counts.set(base, currentCount + 1);
    return currentCount === 0 ? base : `${base}_${currentCount + 1}`;
  });
}

function normalizeRowCellValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.length > 0 ? value : null;
}

function hasNonNullValue(row: NormalizedImportRow) {
  return Object.values(row).some((value) => value !== null);
}

function buildApprovedTableKey(sourcePage: number, tableIndex: number) {
  return `${sourcePage}:${tableIndex}`;
}

function parseProvenanceDefaults(input: JsonRecord): TabularPdfDefaults {
  const validation = asRecord(input.validation);
  const nested = asRecord(
    input.provenanceDefaults ??
      input.provenance_defaults ??
      validation?.provenanceDefaults ??
      validation?.provenance_defaults
  );

  return {
    source_file_name:
      toNullableString(
        nested?.sourceFileName ??
          nested?.source_file_name ??
          input.sourceFileName ??
          input.source_file_name
      ) ?? null,
    source_document_id:
      toNullableString(
        nested?.sourceDocumentId ??
          nested?.source_document_id ??
          input.sourceDocumentId ??
          input.source_document_id
      ) ?? null,
  };
}

function parseTableRows(rows: unknown[], tableIndex: number): TabularPdfDetectedRow[] {
  return rows.map((row, rowIndex) => {
    const record = asRecord(row);
    if (!record) {
      throw new Error(
        `tables[${tableIndex}].rows[${rowIndex}] invalide. Utiliser un objet { cells }.`
      );
    }

    const cells = Array.isArray(record.cells)
      ? record.cells.map(normalizeCell)
      : null;

    if (!cells) {
      throw new Error(
        `tables[${tableIndex}].rows[${rowIndex}].cells invalide. Utiliser un tableau.`
      );
    }

    return {
      row_index: parsePositiveInteger(
        record.row_index ?? record.rowIndex ?? rowIndex,
        `tables[${tableIndex}].rows[${rowIndex}].row_index`,
        0
      ),
      cells,
    };
  });
}

function parseDetectedTables(value: unknown): TabularPdfDetectedTable[] {
  const tables = Array.isArray(value) ? value : null;
  if (!tables) {
    throw new Error("tables est requis pour un DPGF PDF tabulaire.");
  }

  return tables.map((table, tableIndex) => {
    const record = asRecord(table);
    if (!record) {
      throw new Error(
        `tables[${tableIndex}] invalide. Utiliser un objet { page, headers, rows }.`
      );
    }

    const headers = Array.isArray(record.headers)
      ? record.headers.map(normalizeHeader)
      : null;
    const rows = Array.isArray(record.rows)
      ? parseTableRows(record.rows, tableIndex)
      : null;

    if (!headers) {
      throw new Error(
        `tables[${tableIndex}].headers invalide. Utiliser un tableau.`
      );
    }

    if (!rows) {
      throw new Error(`tables[${tableIndex}].rows invalide. Utiliser un tableau.`);
    }

    return {
      source_page: parsePositiveInteger(
        record.page ?? record.sourcePage ?? record.source_page,
        `tables[${tableIndex}].page`
      ),
      table_index: parsePositiveInteger(
        record.table_index ?? record.tableIndex ?? tableIndex,
        `tables[${tableIndex}].tableIndex`,
        0
      ),
      title: toNullableString(record.title),
      headers,
      rows,
    };
  });
}

function summarizeTableIssues(table: TabularPdfDetectedTable): TabularPdfTableIssue[] {
  const issues: TabularPdfTableIssue[] = [];
  const nonEmptyHeaders = table.headers.filter((header) => header.length > 0);

  if (nonEmptyHeaders.length < 2) {
    issues.push({
      code: "missing_headers",
      severity: "error",
      message: "Le tableau doit exposer au moins deux colonnes detectees.",
    });
  }

  const normalizedHeaders = nonEmptyHeaders.map((header) => header.toLowerCase());
  const duplicateHeaders = normalizedHeaders.length !== new Set(normalizedHeaders).size;
  if (duplicateHeaders) {
    issues.push({
      code: "duplicate_headers",
      severity: "warning",
      message: "Des en-tetes dupliques seront dedoublonnes avant le mapping.",
    });
  }

  if (table.rows.length === 0) {
    issues.push({
      code: "empty_table",
      severity: "error",
      message: "Le tableau detecte ne contient aucune ligne exploitable.",
    });
    return issues;
  }

  let sparseRowCount = 0;
  let mismatchedWidthCount = 0;

  table.rows.forEach((row) => {
    const nonEmptyCells = row.cells.filter((cell) => cell.length > 0).length;
    if (nonEmptyCells < 2) {
      sparseRowCount += 1;
    }

    if (table.headers.length > 0 && row.cells.length !== table.headers.length) {
      mismatchedWidthCount += 1;
    }
  });

  if (sparseRowCount === table.rows.length) {
    issues.push({
      code: "empty_table",
      severity: "error",
      message: "Les lignes detectees sont trop vides pour converger proprement vers le mapping.",
    });
  } else if (sparseRowCount > 0) {
    issues.push({
      code: "sparse_rows",
      severity: "warning",
      message: "Certaines lignes sont partielles et devront etre revues avant validation.",
    });
  }

  if (mismatchedWidthCount > 0) {
    issues.push({
      code: "row_width_mismatch",
      severity: "warning",
      message: "Le nombre de cellules varie selon les lignes de ce tableau.",
    });
  }

  return issues;
}

function decisionFromIssues(issues: TabularPdfTableIssue[]): TabularPdfTableDecision {
  if (issues.some((issue) => issue.severity === "error")) {
    return "reject";
  }

  if (issues.length > 0) {
    return "review";
  }

  return "approve";
}

export function buildTabularPdfImportReview(
  body: unknown
): TabularPdfImportReview {
  const input = asRecord(body);
  if (!input) {
    throw new Error("Payload JSON invalide.");
  }

  const defaults = parseProvenanceDefaults(input);
  const tables = parseDetectedTables(input.tables);

  const reviewedTables = tables.map<TabularPdfReviewTable>((table) => {
    const issues = summarizeTableIssues(table);

    return {
      source_page: table.source_page,
      table_index: table.table_index,
      title: table.title,
      headers: table.headers,
      row_count: table.rows.length,
      sample_rows: table.rows.slice(0, 3).map((row) => row.cells),
      decision: decisionFromIssues(issues),
      issues,
    };
  });

  const suggestedApprovedTables = reviewedTables
    .filter((table) => table.decision !== "reject")
    .map((table) => ({
      sourcePage: table.source_page,
      tableIndex: table.table_index,
    }));

  const approvableTables = reviewedTables.filter((table) => table.decision !== "reject");
  const approvableRows = approvableTables.reduce((sum, table) => sum + table.row_count, 0);
  const totalRows = reviewedTables.reduce((sum, table) => sum + table.row_count, 0);
  const rejectedTables = reviewedTables.length - approvableTables.length;

  let reviewState: TabularPdfReviewState = "manual_required";
  if (approvableTables.length > 0) {
    reviewState =
      rejectedTables > 0 || approvableTables.some((table) => table.decision === "review")
      ? "reinforced_validation"
      : "light_validation";
  }

  return {
    review_state: reviewState,
    import_filename: defaults.source_file_name,
    source_file_name: defaults.source_file_name,
    source_document_id: defaults.source_document_id,
    summary: {
      total_tables: reviewedTables.length,
      approvable_tables: approvableTables.length,
      rejected_tables: rejectedTables,
      total_rows: totalRows,
      approvable_rows: approvableRows,
    },
    suggested_approved_tables: suggestedApprovedTables,
    tables: reviewedTables,
  };
}

function buildRowObjectFromTableRow(
  headers: string[],
  cells: string[]
): NormalizedImportRow {
  const columnCount = Math.max(headers.length, cells.length);
  const normalizedHeaders = Array.from({ length: columnCount }, (_, index) => headers[index] ?? "");
  const dedupedHeaders = dedupeHeaders(normalizedHeaders);
  const record: NormalizedImportRow = {};

  dedupedHeaders.forEach((header, index) => {
    record[header] = normalizeRowCellValue(cells[index]);
  });

  return record;
}

export function buildApprovedTabularPdfRows(input: {
  body: JsonRecord;
  approvedTables: Set<string>;
}): NormalizedImportRow[] {
  const defaults = parseProvenanceDefaults(input.body);
  const tables = parseDetectedTables(input.body.tables);
  const review = buildTabularPdfImportReview(input.body);
  const decisionByKey = new Map(
    review.tables.map((table) => [
      buildApprovedTableKey(table.source_page, table.table_index),
      table.decision,
    ])
  );

  const normalizedRows: NormalizedImportRow[] = [];

  tables.forEach((table) => {
    const key = buildApprovedTableKey(table.source_page, table.table_index);
    if (!input.approvedTables.has(key)) {
      return;
    }

    const decision = decisionByKey.get(key) ?? "reject";
    if (decision === "reject") {
      throw new Error(
        `Le tableau PDF ${key} est trop degrade pour converger vers le pipeline canonique.`
      );
    }

    table.rows.forEach((row) => {
      const normalizedRow = buildRowObjectFromTableRow(table.headers, row.cells);
      if (!hasNonNullValue(normalizedRow)) {
        return;
      }

      const provenance: ImportRowProvenance = {
        source_page: table.source_page,
        table_index: table.table_index,
        source_file_name: defaults.source_file_name,
        source_document_id: defaults.source_document_id,
      };

      normalizedRows.push(
        attachImportRowProvenance(
          normalizedRow,
          provenance
        )
      );
    });
  });

  if (normalizedRows.length === 0) {
    throw new Error(
      "Aucune ligne exploitable n'a ete retenue apres validation des tableaux PDF."
    );
  }

  return normalizedRows;
}
