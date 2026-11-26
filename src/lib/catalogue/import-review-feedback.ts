import type { BulkValidateResult } from "@/lib/catalogue/import-review-contract";

export const CATALOGUE_BULK_INCOMPLETE = "CATALOGUE_BULK_INCOMPLETE";

export function bulkValidationSummary({ validated, incomplete, skipped }: BulkValidateResult) {
  return `${validated.toLocaleString("fr-FR")} ${validated === 1 ? "brouillon validé" : "brouillons validés"}. `
    + `${incomplete.toLocaleString("fr-FR")} ${incomplete === 1 ? "brouillon incomplet à compléter" : "brouillons incomplets à compléter"}. `
    + `${skipped.toLocaleString("fr-FR")} ${skipped === 1 ? "article ignoré" : "articles ignorés"}.`;
}
