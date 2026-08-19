import { downloadBlob } from "@/lib/browser-download";

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

type XlsxModule = typeof import("xlsx");

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
  xlsx: XlsxModule,
  data: T[],
  columns: ExportColumn<T>[]
) {
  const exportData = prepareExportData(data, columns);
  const worksheet = xlsx.utils.aoa_to_sheet(exportData);

  const colWidths = columns.map((_, index) => {
    const maxLength = Math.max(
      ...exportData.map((row) => String(row[index]).length)
    );
    return { wch: Math.min(Math.max(maxLength, 10), 50) };
  });
  worksheet["!cols"] = colWidths;

  return worksheet;
}

export async function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions
): Promise<void> {
  const xlsx = await import("xlsx");
  const worksheet = buildWorksheet(xlsx, data, columns);

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(
    workbook,
    worksheet,
    options.sheetName ?? "Export"
  );

  xlsx.writeFile(workbook, `${options.filename}.xlsx`);
}

export async function exportToExcelWithSheets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: ExportSheet<any>[],
  options: ExportOptions
): Promise<void> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.utils.book_new();

  sheets.forEach((sheet) => {
    const worksheet = buildWorksheet(xlsx, sheet.data, sheet.columns);
    xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name);
  });

  xlsx.writeFile(workbook, `${options.filename}.xlsx`);
}

export async function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: ExportColumn<T>[],
  options: ExportOptions
): Promise<void> {
  const xlsx = await import("xlsx");
  const exportData = prepareExportData(data, columns);
  const worksheet = xlsx.utils.aoa_to_sheet(exportData);
  const csvContent = xlsx.utils.sheet_to_csv(worksheet, { FS: ";" });

  const blob = new Blob(["\ufeff" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `${options.filename}.csv`);
}
