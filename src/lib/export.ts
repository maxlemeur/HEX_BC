import * as XLSX from "xlsx";

export type ExportColumn<T> = {
  key: keyof T | string;
  header: string;
  formatter?: (value: unknown, row: T) => string | number;
};

export type ExportOptions = {
  filename: string;
  sheetName?: string;
};

export type ExportSheet<T extends Record<string, unknown>> = {
  name: string;
  data: T[];
  columns: ExportColumn<T>[];
};

function getNestedValue<T>(obj: T, path: string): unknown {
  return path.split(".").reduce((current: unknown, key: string) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function prepareExportData<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[]
): (string | number)[][] {
  const headers = columns.map((col) => col.header);

  const rows = data.map((row) =>
    columns.map((col) => {
      const rawValue = getNestedValue(row, col.key as string);
      if (col.formatter) {
        return col.formatter(rawValue, row);
      }
      if (rawValue === null || rawValue === undefined) {
        return "";
      }
      return rawValue as string | number;
    })
  );

  return [headers, ...rows];
}

function buildWorksheet<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[]
) {
  const exportData = prepareExportData(data, columns);
  const worksheet = XLSX.utils.aoa_to_sheet(exportData);

  const colWidths = columns.map((_, index) => {
    const maxLength = Math.max(
      ...exportData.map((row) => String(row[index]).length)
    );
    return { wch: Math.min(Math.max(maxLength, 10), 50) };
  });
  worksheet["!cols"] = colWidths;

  return worksheet;
}

export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions
): void {
  const worksheet = buildWorksheet(data, columns);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    options.sheetName ?? "Export"
  );

  XLSX.writeFile(workbook, `${options.filename}.xlsx`);
}

export function exportToExcelWithSheets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: ExportSheet<any>[],
  options: ExportOptions
): void {
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const worksheet = buildWorksheet(sheet.data, sheet.columns);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  });

  XLSX.writeFile(workbook, `${options.filename}.xlsx`);
}

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions
): void {
  const exportData = prepareExportData(data, columns);
  const worksheet = XLSX.utils.aoa_to_sheet(exportData);
  const csvContent = XLSX.utils.sheet_to_csv(worksheet, { FS: ";" });

  const blob = new Blob(["\ufeff" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${options.filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
