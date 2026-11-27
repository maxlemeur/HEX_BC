import { workbookSupplierNameKey } from "@/lib/catalogue/costing-workbook";
import { supplierPickerLabels, type SupplierIdentity } from "@/lib/catalogue/supplier-labels";

import type { MaterialRequestWorkbookPreview, MaterialRequestWorkbookSupplier } from "./workbook-preview-contract";
import type { MaterialRequestWorkbookReading } from "./workbook-preview";

/**
 * The supplier names of a needs list, resolved as the catalogue workbook import resolves them
 * (costing-workbook-supplier-references-server.ts): an association recorded for the spelling decides, and never
 * falls back to a homonym; otherwise one active supplier of that name. Nothing is created or associated here.
 */

export type WorkbookSupplierDirectory = {
  /** Active suppliers of the company. */
  suppliers: ReadonlyArray<SupplierIdentity>;
  /** Deactivated suppliers of the company, to name the one an association still points to. */
  inactiveSuppliers: ReadonlyArray<{ id: string; name: string }>;
  /** Associations of the company: spelling key to supplier, whether active or not. */
  aliases: ReadonlyArray<{ alias_key: string; supplier_id: string }>;
};

/** Where an association is withdrawn today: the catalogue's workbook import, view « Noms associés ». */
function inactiveAliasRemark(supplierName: string | undefined) {
  const named = supplierName ? `au fournisseur désactivé « ${supplierName} »` : "à un fournisseur désactivé";
  return `Ce nom est associé ${named}. Réactivez ce fournisseur dans le catalogue, ou retirez l’association dans Catalogue, Import du classeur, vue « Noms associés ». En attendant, ces lignes sont importées sans fournisseur.`;
}

const MAX_CANDIDATES = 20;

export function resolveWorkbookSuppliers(
  reading: MaterialRequestWorkbookReading,
  directory: WorkbookSupplierDirectory,
  rights: MaterialRequestWorkbookPreview["supplier_rights"],
): MaterialRequestWorkbookPreview {
  const labels = supplierPickerLabels(directory.suppliers);
  const activeById = new Map(directory.suppliers.map((supplier) => [supplier.id, supplier]));
  const byName = new Map<string, SupplierIdentity[]>();
  for (const supplier of directory.suppliers) {
    const key = workbookSupplierNameKey(supplier.name);
    byName.set(key, [...(byName.get(key) ?? []), supplier]);
  }
  const aliasByKey = new Map(directory.aliases.map((alias) => [alias.alias_key, alias.supplier_id]));
  const inactiveById = new Map(directory.inactiveSuppliers.map((supplier) => [supplier.id, supplier.name]));

  const names = new Map<string, MaterialRequestWorkbookSupplier>();
  const rows = reading.rows.map((row) => {
    const key = row.supplier_name ? workbookSupplierNameKey(row.supplier_name) : "";
    if (!row.supplier_name || !key) return row;
    let entry = names.get(key);
    if (entry) {
      entry.row_count += 1;
    } else {
      const aliasTarget = aliasByKey.get(key);
      const matches = aliasTarget === undefined
        ? byName.get(key) ?? []
        : activeById.has(aliasTarget) ? [activeById.get(aliasTarget)!] : [];
      const [only] = matches;
      // The spelling stands for a supplier that is no longer active: neither a link (the spelling is taken) nor a
      // creation (it would add a homonym the association still hides) settles it here.
      const deactivated = aliasTarget !== undefined && matches.length === 0;
      entry = {
        name: row.supplier_name,
        status: deactivated ? "inactive_alias" : matches.length === 1 ? "recognized" : matches.length > 1 ? "ambiguous" : "unknown",
        supplier_id: matches.length === 1 && only ? only.id : null,
        candidates: matches.length > 1
          ? matches.slice(0, MAX_CANDIDATES).map((supplier) => ({ id: supplier.id, label: labels.get(supplier.id) ?? supplier.name }))
          : [],
        row_count: 1,
        remark: deactivated ? inactiveAliasRemark(inactiveById.get(aliasTarget)) : null,
      };
      names.set(key, entry);
    }
    return entry.supplier_id ? { ...row, line: { ...row.line, supplier_id: entry.supplier_id } } : row;
  });
  return { ...reading, rows, suppliers: [...names.values()], supplier_rights: rights };
}
