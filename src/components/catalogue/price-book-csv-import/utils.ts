import type { ParsedImportRow } from "@/hooks/useFileParser";
import type {
  PriceBookColumnMapping,
  PriceBookProfile,
  PriceBookValidationProgress,
} from "@/lib/catalogue/csv-import";

import { fetchApi } from "@/components/catalogue/api";

import type { CreateImportResponse } from "@/components/catalogue/price-book-csv-import/types";

export const ACCEPTED_FILE_TYPES = ".csv,text/csv,application/csv,text/plain";
export const ATOMIC_BULK_BATCH_SIZE = 5000;

export const TARGET_FIELDS = [
  { value: "supplier_name", label: "Fournisseur", required: true },
  { value: "product_reference", label: "Référence produit" },
  { value: "product_designation", label: "Designation produit" },
  { value: "unit_price", label: "Prix unitaire", required: true },
  { value: "currency", label: "Devise" },
];

export const GUIDE_STEPS = ["Charger", "Detection", "Associer", "Resoudre", "Importer"];

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

export function getProgressLabel(progress: PriceBookValidationProgress | null): string {
  if (!progress) return "0%";
  return `${progress.percentage}% (${formatNumber(progress.processed)} / ${formatNumber(progress.total)})`;
}

export function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".csv");
}

export function getProfileLabel(profile: PriceBookProfile | null): string | null {
  if (!profile) return null;
  if (profile === "mm_bdc") return "Format BDC detecte";
  return "Format CSV standard";
}

export function escapeCsvCell(value: string): string {
  if (!value.includes(";") && !value.includes("\n") && !value.includes("\"")) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export function resolveCurrentStep(input: {
  hasRows: boolean;
  hasValidation: boolean;
  canSubmit: boolean;
}): number {
  if (!input.hasRows) return 1;
  if (!input.hasValidation) return 3;
  if (!input.canSubmit) return 4;
  return 5;
}

export function buildUniqueValues(values: string[]): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (set.has(trimmed)) continue;
    set.add(trimmed);
  }
  return Array.from(set);
}

export function buildTargetSources(mapping: PriceBookColumnMapping) {
  const targetToSource = new Map<string, string>();
  Object.entries(mapping).forEach(([source, target]) => {
    if (!targetToSource.has(target)) {
      targetToSource.set(target, source);
    }
  });
  return targetToSource;
}

export function applyAutomaticResolutions(input: {
  rows: ParsedImportRow[];
  detectedProfile: PriceBookProfile;
  mapping: PriceBookColumnMapping;
  supplierReplacements: Map<string, string>;
  productReplacements: Map<string, string>;
}): ParsedImportRow[] {
  const {
    rows,
    detectedProfile,
    mapping,
    supplierReplacements,
    productReplacements,
  } = input;
  const targetSources = buildTargetSources(mapping);
  const supplierSource = targetSources.get("supplier_name") ?? null;
  const productRefSource = targetSources.get("product_reference") ?? null;
  const productDesignationSource = targetSources.get("product_designation") ?? null;

  return rows.map((row) => {
    const nextRow = { ...row };

    if (detectedProfile === "mm_bdc") {
      ["F1_nom", "F2_nom", "F3_nom"].forEach((column) => {
        const current = String(nextRow[column] ?? "").trim();
        const replacement = supplierReplacements.get(current);
        if (replacement) {
          nextRow[column] = replacement;
        }
      });

      const currentProduct = String(nextRow.ID ?? "").trim();
      const replacementProduct = productReplacements.get(currentProduct);
      if (replacementProduct) {
        nextRow.ID = replacementProduct;
      }

      return nextRow;
    }

    if (supplierSource) {
      const currentSupplier = String(nextRow[supplierSource] ?? "").trim();
      const replacementSupplier = supplierReplacements.get(currentSupplier);
      if (replacementSupplier) {
        nextRow[supplierSource] = replacementSupplier;
      }
    }

    if (productRefSource) {
      const currentProductRef = String(nextRow[productRefSource] ?? "").trim();
      const replacementRef = productReplacements.get(currentProductRef);
      if (replacementRef) {
        nextRow[productRefSource] = replacementRef;
      }
    }

    if (productDesignationSource) {
      const currentProductDesignation = String(nextRow[productDesignationSource] ?? "").trim();
      const replacementDesignation = productReplacements.get(currentProductDesignation);
      if (replacementDesignation) {
        nextRow[productDesignationSource] = replacementDesignation;
      }
    }

    return nextRow;
  });
}

export async function createCanonicalPriceImport(file: File) {
  const formData = new FormData();
  // Supplier price CSVs stay detached from affaire-linked DPGF imports.
  formData.set("file", file);

  return fetchApi<CreateImportResponse>("/api/imports", {
    method: "POST",
    body: formData,
  });
}

export function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
