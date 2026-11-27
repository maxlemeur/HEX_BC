import "server-only";

import { canAddToCatalogue } from "@/lib/catalogue/access";
import { mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";

import { readMaterialRequestWorkbookOriginal } from "./files-server";
import { readRequestLines, requireProjectAccess } from "./server-shared";
import type { WorkbookMapping } from "./workbook-mapping";
import { previewMaterialRequestWorkbook } from "./workbook-preview";
import type { MaterialRequestWorkbookPreview } from "./workbook-preview-contract";
import { resolveWorkbookSuppliers } from "./workbook-suppliers";

/** Why the create and link choices are absent; the catalogue's own rule (admins and engineers add suppliers). */
const SUPPLIER_RIGHTS_REFUSAL = "Seuls les administrateurs et les ingénieurs ajoutent des fournisseurs ou des noms associés au catalogue. Ces lignes seront importées sans fournisseur.";

/**
 * The preview of an Excel original before its lines are added (write access to the affaire, as the import that
 * follows): the rows as the mapping reads them, compared with the request's lines, and the supplier names resolved
 * against the company's suppliers and associations. Nothing is written.
 */
export async function previewMaterialRequestWorkbookImport(
  projectId: string,
  requestId: string,
  fileId: string,
  options: { sheet?: string; headerRow?: number; mapping?: WorkbookMapping },
  signal?: AbortSignal,
): Promise<MaterialRequestWorkbookPreview> {
  const access = await requireProjectAccess(projectId, "write");
  const body = await readMaterialRequestWorkbookOriginal(access, requestId, fileId);
  const existingLines = await readRequestLines(access, requestId);
  const reading = await previewMaterialRequestWorkbook(Buffer.from(await body.arrayBuffer()), { ...options, existingLines }, signal);

  const { supabase, tenantId, tenantRole } = access.context;
  const mayEdit = canAddToCatalogue(tenantRole);
  const rights = { can_link: mayEdit, can_create: mayEdit, reason: mayEdit ? null : SUPPLIER_RIGHTS_REFUSAL };
  if (!reading.rows.some((row) => row.supplier_name)) {
    return resolveWorkbookSuppliers(reading, { suppliers: [], inactiveSuppliers: [], aliases: [] }, rights);
  }

  // readAllRows pages by `id`: every projection names it.
  const [suppliers, aliases] = await Promise.all([
    readAllRows(() => supabase.from("suppliers").select("id, name, city, email, siret, created_at, is_active", { count: "exact" })
      .eq("tenant_id", tenantId)),
    readAllRows(() => supabase.from("supplier_aliases").select("id, alias_key, supplier_id", { count: "exact" }).eq("tenant_id", tenantId)),
  ]);
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de lire les fournisseurs.");
  if (aliases.error) throw mapSupabaseError(aliases.error, "Impossible de lire les noms associés aux fournisseurs.");
  const all = suppliers.data ?? [];
  return resolveWorkbookSuppliers(reading, {
    suppliers: all.filter((supplier) => supplier.is_active),
    inactiveSuppliers: all.filter((supplier) => !supplier.is_active),
    aliases: aliases.data ?? [],
  }, rights);
}
