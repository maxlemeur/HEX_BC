import "server-only";

import { createHash } from "node:crypto";

import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { buildCatalogueAccess, canAddToCatalogue, canEditCatalogueRecord } from "@/lib/catalogue/access";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { readCostingWorkbookImportSheet } from "@/lib/catalogue/costing-workbook-server";
import { workbookReferenceKey, type CostingWorkbookSupplierOccurrence } from "@/lib/catalogue/costing-workbook";
import type {
  CostingWorkbookSupplierReferenceReport,
  CostingWorkbookSupplierReferencesInput,
} from "@/lib/catalogue/costing-workbook-contract";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { conflict, forbidden, mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { foldText } from "@/lib/text/fold";

type Occurrence = CostingWorkbookSupplierOccurrence;
type Decision = CostingWorkbookSupplierReferenceReport["for_decision"][number];
type Candidate = {
  product_id: string;
  product_reference: string;
  supplier_id: string;
  supplier_name: string;
  supplier_sku: string;
};

const CATALOGUE_CHANGED = "Le catalogue a changé depuis l’aperçu. Actualisez l’aperçu avant de confirmer.";

function supplierNameKey(name: string) {
  return foldText(name).trim().replace(/\s+/g, " ");
}

function pairKey(productId: string, supplierId: string) {
  return productId + "/" + supplierId;
}

function groupBy<T>(entries: readonly T[], keyOf: (entry: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return groups;
}

async function planReferences(context: AuthenticatedTenantContext, occurrences: Occurrence[]) {
  const { supabase, tenantId, tenantRole, userId } = context;
  const [products, suppliers, engineersCanEditShared] = await Promise.all([
    readAllRows(() => supabase.from("products").select("id, reference, created_by", { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true).not("reference", "is", null), { concurrency: 4 }),
    readAllRows(() => supabase.from("suppliers").select("id, name", { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true)),
    tenantRole === "engineer" ? readEngineersCanEditShared(supabase, tenantId) : false,
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de lire les articles du catalogue.");
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de lire les fournisseurs.");

  const access = buildCatalogueAccess({ userId, role: tenantRole, engineersCanEditShared });
  const articlesByReference = groupBy(products.data ?? [], (product) => workbookReferenceKey(product.reference ?? ""));
  const suppliersByName = groupBy(suppliers.data ?? [], (supplier) => supplierNameKey(supplier.name));

  const decisions: Decision[] = [];
  const refuse = (occurrence: Occurrence, reason: Decision["reason"]) => {
    decisions.push({
      row: occurrence.row,
      slot: occurrence.slot,
      reason,
    });
  };

  const matches: Array<{ occurrence: Occurrence; candidate: Candidate }> = [];
  for (const occurrence of occurrences) {
    if (!occurrence.article_reference_valid) {
      refuse(occurrence, "invalid_article_reference");
      continue;
    }
    if (!occurrence.supplier_name_valid) {
      refuse(occurrence, "invalid_supplier_name");
      continue;
    }
    if (!occurrence.supplier_sku_valid) {
      refuse(occurrence, "invalid_supplier_sku");
      continue;
    }
    const articles = articlesByReference.get(workbookReferenceKey(occurrence.article_reference)) ?? [];
    const supplierMatches = suppliersByName.get(supplierNameKey(occurrence.supplier_name)) ?? [];
    const [article] = articles;
    const [supplier] = supplierMatches;
    if (!article?.reference || articles.length !== 1) {
      refuse(occurrence, articles.length > 1 ? "ambiguous_article" : "article_not_found");
    } else if (!supplier || supplierMatches.length !== 1) {
      refuse(occurrence, supplierMatches.length > 1 ? "ambiguous_supplier" : "supplier_not_found");
    } else if (!canEditCatalogueRecord(access, article.created_by)) {
      refuse(occurrence, "article_locked");
    } else {
      matches.push({ occurrence, candidate: {
        product_id: article.id, product_reference: article.reference,
        supplier_id: supplier.id, supplier_name: supplier.name, supplier_sku: occurrence.supplier_sku,
      } });
    }
  }

  const productIds = [...new Set(matches.map(({ candidate }) => candidate.product_id))];
  const existing = await readAllRowsInChunks(productIds, (chunk) => supabase.from("supplier_catalog_items")
    .select("id, product_id, supplier_id, supplier_sku, is_active, reference_needs_review", { count: "exact" })
    .eq("tenant_id", tenantId).in("product_id", chunk));
  if (existing.error) throw mapSupabaseError(existing.error, "Impossible de lire les références déjà enregistrées.");
  const existingByPair = new Map((existing.data ?? []).map((item) => [pairKey(item.product_id, item.supplier_id), item]));

  const candidates: Candidate[] = [];
  let alreadyRegistered = 0;
  let duplicates = 0;
  for (const [pair, entries] of groupBy(matches, ({ candidate }) => pairKey(candidate.product_id, candidate.supplier_id))) {
    const { candidate } = entries[0];
    const item = existingByPair.get(pair);

    // The catalogue holds a single reference per pair. Never choose between competing SKUs or reactivate a withdrawn item.
    if (entries.some((entry) => entry.candidate.supplier_sku !== candidate.supplier_sku)) {
      for (const entry of entries) refuse(entry.occurrence, "conflicting_workbook_references");
    } else if (item && !item.is_active && !item.reference_needs_review) {
      for (const entry of entries) refuse(entry.occurrence, "withdrawn_reference");
    } else if (item && item.supplier_sku !== candidate.supplier_sku) {
      for (const entry of entries) refuse(entry.occurrence, "different_existing_reference");
    } else {
      duplicates += entries.length - 1;
      if (item) alreadyRegistered += 1;
      else candidates.push(candidate);
    }
  }
  decisions.sort((left, right) => left.row - right.row || left.slot - right.slot);
  return { candidates, alreadyRegistered, duplicates, decisions };
}

export async function importCostingWorkbookSupplierReferences(
  input: CostingWorkbookSupplierReferencesInput,
): Promise<CostingWorkbookSupplierReferenceReport> {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);

  const { supplierReferenceOccurrences } = readCostingWorkbookImportSheet(input.rows);
  const plan = await planReferences(context, supplierReferenceOccurrences);
  const previewToken = createHash("sha256")
    .update(JSON.stringify([context.tenantId, context.userId, plan.candidates])).digest("hex");

  let imported = 0;
  if (input.confirm) {
    if (input.preview_token !== previewToken) throw conflict(CATALOGUE_CHANGED);
    if (plan.candidates.length > 0) {
      const { data, error } = await context.supabase.rpc("import_workbook_supplier_references", {
        p_tenant_id: context.tenantId,
        p_rows: plan.candidates,
      });
      if (error?.code === "42501") throw forbidden(PRODUCT_WRITE_REFUSAL);
      if (error?.message === "WORKBOOK_SUPPLIER_REFERENCES_CHANGED" || error?.code === "40P01") {
        throw conflict(CATALOGUE_CHANGED);
      }
      if (error) throw mapSupabaseError(error, "Impossible d’enregistrer les références du classeur.");
      imported = data;
    }
  }

  return {
    confirmed: input.confirm,
    to_import: input.confirm ? 0 : plan.candidates.length,
    imported,
    already_registered: plan.alreadyRegistered,
    duplicates: plan.duplicates,
    preview_token: input.confirm ? null : previewToken,
    for_decision: plan.decisions,
  };
}
