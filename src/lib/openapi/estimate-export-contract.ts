import { z } from "zod";

export const estimateExportFormatQueryParameter = {
  name: "format",
  in: "query" as const,
  description:
    "Format d'export : xlsx (defaut) ou csv. Le csv est le CSV de l'editeur d'une version du moteur de calcul 3, ecrit depuis son document (mode standard uniquement) ; une version v1/v2 recoit 409 ESTIMATE_CSV_EXPORT_V3_ONLY.",
  schemaName: "ExportFormatQueryParameter",
  schema: z.enum(["xlsx", "csv"]),
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
