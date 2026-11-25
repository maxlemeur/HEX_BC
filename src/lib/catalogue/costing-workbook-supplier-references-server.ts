import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { buildCatalogueAccess, canAddToCatalogue, canEditCatalogueRecord } from "@/lib/catalogue/access";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { readCostingWorkbookImportSheet } from "@/lib/catalogue/costing-workbook-server";
import {
  workbookReferenceKey,
  workbookSupplierNameKey,
  type CostingWorkbookReadResult,
  type CostingWorkbookSupplierOccurrence,
} from "@/lib/catalogue/costing-workbook";
import type {
  CostingWorkbookSupplierReferenceReport,
  CostingWorkbookSupplierReferencesInput,
} from "@/lib/catalogue/costing-workbook-contract";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { supplierPickerLabels } from "@/lib/catalogue/supplier-labels";
import { conflict, forbidden, mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";

type Occurrence = CostingWorkbookSupplierOccurrence;
type Decision = CostingWorkbookSupplierReferenceReport["for_decision"][number];
type Candidate = {
  product_id: string;
  product_reference: string;
  supplier_id: string;
  supplier_name: string;
  supplier_sku: string;
  /** The article's page at the supplier, imported with the reference and checked with it. */
  product_url: string | null;
};

const CATALOGUE_CHANGED = "Le catalogue a changé depuis l’aperçu. Actualisez l’aperçu avant de confirmer.";

/** What import_workbook_supplier_reference_batch answers. */
const importAnswerSchema = z.object({ batch_id: z.string(), imported: z.number().int().nonnegative() });

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

/** Records named to the office when several share an identifier or a name: enough to tell them apart. */
const MAX_CANDIDATES = 20;

async function planReferences(context: AuthenticatedTenantContext, { articles: readArticles, supplierReferenceOccurrences: occurrences }: CostingWorkbookReadResult) {
  const { supabase, tenantId, tenantRole, userId } = context;
  const [products, suppliers, aliases, engineersCanEditShared] = await Promise.all([
    // Archived articles too: the draft import skips their reference, so it is not one « to create ».
    readAllRows(() => supabase.from("products").select("id, reference, designation, created_by, is_active", { count: "exact" })
      .eq("tenant_id", tenantId).not("reference", "is", null), { concurrency: 4 }),
    readAllRows(() => supabase.from("suppliers").select("id, name, city, email, siret, created_at", { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true)),
    readAllRows(() => supabase.from("supplier_aliases").select("id, supplier_id, alias_key", { count: "exact" }).eq("tenant_id", tenantId)),
    tenantRole === "engineer" ? readEngineersCanEditShared(supabase, tenantId) : false,
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de lire les articles du catalogue.");
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de lire les fournisseurs.");
  if (aliases.error) throw mapSupabaseError(aliases.error, "Impossible de lire les noms associés aux fournisseurs.");

  const access = buildCatalogueAccess({ userId, role: tenantRole, engineersCanEditShared });
  const heldReferences = new Set((products.data ?? []).map((product) => workbookReferenceKey(product.reference ?? "")));
  const articlesByReference = groupBy((products.data ?? []).filter((product) => product.is_active),
    (product) => workbookReferenceKey(product.reference ?? ""));
  const suppliersByName = groupBy(suppliers.data ?? [], (supplier) => workbookSupplierNameKey(supplier.name));
  const supplierLabels = supplierPickerLabels(suppliers.data ?? []);
  // An explicit association wins. An archived target requires another decision.
  const activeSuppliers = new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier]));
  const supplierOfAlias = new Map((aliases.data ?? []).map((alias) => [alias.alias_key, activeSuppliers.get(alias.supplier_id)]));
  const suppliersNamed = (name: string) => {
    const key = workbookSupplierNameKey(name);
    if (!supplierOfAlias.has(key)) return suppliersByName.get(key) ?? [];
    const aliased = supplierOfAlias.get(key);
    return aliased ? [aliased] : [];
  };
  // What the draft import of the same sheet creates: the references of these articles wait for it.
  const toCreate = new Set(readArticles.map((article) => workbookReferenceKey(article.reference))
    .filter((key) => !heldReferences.has(key)));

  const decisions: Decision[] = [];
  const refuse = (occurrence: Occurrence, reason: Decision["reason"], detail: Omit<Decision, "row" | "slot" | "reason"> = {}) => {
    decisions.push({
      row: occurrence.row,
      slot: occurrence.slot,
      reason,
      ...detail,
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
    if (occurrence.price_source_kind) {
      refuse(occurrence, "price_source_reference");
      continue;
    }
    const articles = articlesByReference.get(workbookReferenceKey(occurrence.article_reference)) ?? [];
    const supplierMatches = suppliersNamed(occurrence.supplier_name);
    const [article] = articles;
    const [supplier] = supplierMatches;
    if (!article?.reference || articles.length !== 1) {
      if (articles.length > 1) {
        refuse(occurrence, "ambiguous_article", {
          candidates: articles.slice(0, MAX_CANDIDATES).map(({ id, reference, designation }) => ({ id, label: `${reference} · ${designation}` })),
        });
      } else {
        refuse(occurrence, toCreate.has(workbookReferenceKey(occurrence.article_reference)) ? "article_to_create" : "article_not_found");
      }
    } else if (!supplier || supplierMatches.length !== 1) {
      if (supplierMatches.length > 1) {
        refuse(occurrence, "ambiguous_supplier", {
          product_id: article.id,
          candidates: supplierMatches.slice(0, MAX_CANDIDATES).map(({ id, name }) => ({ id, label: supplierLabels.get(id) ?? name })),
        });
      } else {
        refuse(occurrence, "supplier_not_found", { product_id: article.id });
      }
    } else if (!canEditCatalogueRecord(access, article.created_by)) {
      refuse(occurrence, "article_locked", { product_id: article.id, supplier_id: supplier.id });
    } else {
      matches.push({ occurrence, candidate: {
        product_id: article.id, product_reference: article.reference,
        supplier_id: supplier.id, supplier_name: supplier.name, supplier_sku: occurrence.supplier_sku,
        product_url: occurrence.product_url,
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
  const proposed: NonNullable<CostingWorkbookSupplierReferenceReport["proposed"]> = [];
  let alreadyRegistered = 0;
  let duplicates = 0;
  for (const [pair, entries] of groupBy(matches, ({ candidate }) => pairKey(candidate.product_id, candidate.supplier_id))) {
    const { candidate, occurrence } = entries[0];
    const item = existingByPair.get(pair);

    // The catalogue holds a single reference per pair. Never choose between competing SKUs or reactivate a withdrawn item.
    const matched = { product_id: candidate.product_id, supplier_id: candidate.supplier_id };
    if (entries.some((entry) => entry.candidate.supplier_sku !== candidate.supplier_sku)) {
      for (const entry of entries) refuse(entry.occurrence, "conflicting_workbook_references", matched);
    } else if (item && !item.is_active && !item.reference_needs_review) {
      for (const entry of entries) refuse(entry.occurrence, "withdrawn_reference", matched);
    } else if (item && item.supplier_sku !== candidate.supplier_sku) {
      for (const entry of entries) {
        refuse(entry.occurrence, "different_existing_reference", { ...matched, existing_supplier_sku: item.supplier_sku });
      }
    } else {
      duplicates += entries.length - 1;
      if (item) alreadyRegistered += 1;
      else {
        // The same code on several rows: the first link the workbook gives for it.
        candidates.push({ ...candidate, product_url: entries.find((entry) => entry.candidate.product_url)?.candidate.product_url ?? null });
        proposed.push({
          row: occurrence.row,
          slot: occurrence.slot,
          article_reference: candidate.product_reference,
          supplier_name: candidate.supplier_name,
          product_id: candidate.product_id,
        });
      }
    }
  }
  decisions.sort((left, right) => left.row - right.row || left.slot - right.slot);
  return { candidates, proposed, alreadyRegistered, duplicates, decisions };
}

export async function importCostingWorkbookSupplierReferences(
  input: CostingWorkbookSupplierReferencesInput,
): Promise<CostingWorkbookSupplierReferenceReport> {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);

  const plan = await planReferences(context, readCostingWorkbookImportSheet(input.rows));
  const previewToken = createHash("sha256")
    .update(JSON.stringify([context.tenantId, context.userId, plan.candidates])).digest("hex");

  let imported = 0;
  let batchId: string | null = null;
  if (input.confirm) {
    if (input.preview_token !== previewToken) throw conflict(CATALOGUE_CHANGED);
    if (plan.candidates.length > 0) {
      // One batch: the references are written together or not at all, under the import they belong to.
      const { data, error } = await context.supabase.rpc("import_workbook_supplier_reference_batch", {
        p_tenant_id: context.tenantId,
        p_rows: plan.candidates,
        p_source_name: input.source_name ?? null,
      });
      if (error?.code === "42501") throw forbidden(PRODUCT_WRITE_REFUSAL);
      if (error?.message === "WORKBOOK_SUPPLIER_REFERENCES_CHANGED" || error?.code === "40P01") {
        throw conflict(CATALOGUE_CHANGED);
      }
      if (error) throw mapSupabaseError(error, "Impossible d’enregistrer les références du classeur.");
      const answer = importAnswerSchema.safeParse(data);
      if (!answer.success) throw mapSupabaseError({ code: "XX000", message: "Réponse inattendue de l’import." }, "Impossible d’enregistrer les références du classeur.");
      imported = answer.data.imported;
      batchId = answer.data.batch_id;
    }
  }

  return {
    confirmed: input.confirm,
    to_import: input.confirm ? 0 : plan.candidates.length,
    imported,
    already_registered: plan.alreadyRegistered,
    duplicates: plan.duplicates,
    preview_token: input.confirm ? null : previewToken,
    ...(input.confirm ? { import_batch_id: batchId } : {}),
    // After the confirmation, the same list is what was imported: the office checks these references next.
    proposed: plan.proposed,
    for_decision: plan.decisions,
  };
}
