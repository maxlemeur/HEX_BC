import { z } from "zod";

export const estimateExportFormatQueryParameter = {
  name: "format",
  in: "query" as const,
  description: "Format d'export (xlsx uniquement en v1).",
  schemaName: "ExportFormatQueryParameter",
  schema: z.enum(["xlsx"]),
  required: false,
};

export const estimateExportModeQueryParameter = {
  name: "mode",
  in: "query" as const,
  description: "Vue XLSX a produire : devis standard, DPGF ou BDC 1.1.",
  schemaName: "ExportModeQueryParameter",
  schema: z.enum(["standard", "dpgf", "bdc"]),
  required: false,
};
