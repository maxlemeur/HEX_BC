import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { buildCatalogueAccess, canEditCatalogueRecord } from "@/lib/catalogue/access";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { workbookSupplierNameKey } from "@/lib/catalogue/costing-workbook";
import { supplierPickerLabels } from "@/lib/catalogue/supplier-labels";
import { mapSupabaseError } from "@/lib/http/api-response";
import { unitsDiffer, type MatchArticle } from "@/lib/material-requests/matching";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";

import type {
  SupplierBaseGroup, SupplierBasePlannedRow, SupplierBasePreview, SupplierBaseProposal, SupplierBaseRow,
} from "./supplier-base-contract";
import { createSupplierBaseMatcher } from "./supplier-base-matching";
import { flagDuplicateSupplierReferences, supplierBaseReferenceKey } from "./supplier-base-workbook";

const ARTICLE_FIELDS = "id, reference, designation, product_type, material, grade, dimensions, standard, unit, catalogue_status, is_active, created_by";
const pairKey = (left: string, right: string) => JSON.stringify([left, right]);

function groupBy<T>(values: readonly T[], key: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

type DirectoryEntry = Pick<SupplierBaseGroup, "key" | "supplier_id" | "supplier_label" | "resolution" | "candidates">;

async function loadSupplierDirectory({ supabase, tenantId }: AuthenticatedTenantContext) {
  const [suppliers, aliases] = await Promise.all([
    readAllRows(() => supabase.from("suppliers").select("id, name, city, email, siret, created_at", { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true), { concurrency: 4 }),
    readAllRows(() => supabase.from("supplier_aliases").select("id, alias_key, supplier_id", { count: "exact" })
      .eq("tenant_id", tenantId), { concurrency: 4 }),
  ]);
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de lire les fournisseurs.");
  if (aliases.error) throw mapSupabaseError(aliases.error, "Impossible de lire les noms associés aux fournisseurs.");

  const labels = supplierPickerLabels(suppliers.data ?? []);
  const byName = groupBy(suppliers.data ?? [], ({ name }) => workbookSupplierNameKey(name));
  const aliasByName = new Map((aliases.data ?? []).map(({ alias_key, supplier_id }) => [alias_key, supplier_id]));

  // This resolution can later use the same link-or-create flow as material request workbooks.
  return (name: string | null): DirectoryEntry => {
    const nameKey = name ? workbookSupplierNameKey(name) : "";
    const alias = aliasByName.get(nameKey);
    const matches = byName.get(nameKey) ?? [];
    const supplierId = alias ? (labels.has(alias) ? alias : null) : matches.length === 1 ? matches[0].id : null;
    const resolution = supplierId ? "recognized" : !nameKey ? "missing_name"
      : alias ? "inactive_alias" : matches.length > 1 ? "ambiguous" : "unknown";
    return {
      key: supplierId ? `supplier:${supplierId}` : `name:${nameKey}`,
      supplier_id: supplierId,
      supplier_label: supplierId ? labels.get(supplierId) ?? null : null,
      resolution,
      candidates: resolution === "ambiguous" ? matches.slice(0, 20).map(({ id, name }) => ({ id, label: labels.get(id) ?? name })) : [],
    };
  };
}

async function loadCatalogue(context: AuthenticatedTenantContext, supplierIds: string[]) {
  const { supabase, tenantId, tenantRole, userId } = context;
  const [products, references, aliases, engineersCanEditShared] = await Promise.all([
    readAllRows(() => supabase.from("products").select(ARTICLE_FIELDS, { count: "exact" })
      .eq("tenant_id", tenantId), { concurrency: 4 }),
    readAllRowsInChunks(supplierIds, (chunk) => supabase.from("supplier_catalog_items")
      .select("id, product_id, supplier_id, supplier_sku, is_active, reference_needs_review", { count: "exact" })
      .eq("tenant_id", tenantId).in("supplier_id", chunk)),
    readAllRows(() => supabase.from("product_aliases").select("id, product_id, alias", { count: "exact" })
      .eq("tenant_id", tenantId), { concurrency: 4 }),
    tenantRole === "engineer" && readEngineersCanEditShared(supabase, tenantId),
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de lire les articles.");
  if (references.error) throw mapSupabaseError(references.error, "Impossible de lire les références fournisseur.");
  if (aliases.error) throw mapSupabaseError(aliases.error, "Impossible de lire les noms usuels des articles.");

  const aliasesByProduct = groupBy(aliases.data ?? [], ({ product_id }) => product_id);
  const articles = (products.data ?? []).map((product) => ({
    ...product,
    catalogue_status: product.catalogue_status === "draft" ? "draft" as const : "validated" as const,
    supplier_skus: [],
    aliases: (aliasesByProduct.get(product.id) ?? []).map(({ alias }) => alias),
  }));
  return {
    byId: new Map(articles.map((article) => [article.id, article])),
    match: createSupplierBaseMatcher(articles.filter(({ is_active }) => is_active)),
    bySupplierSku: groupBy((references.data ?? []).filter(({ supplier_sku }) => supplier_sku?.trim()),
      ({ supplier_id, supplier_sku }) => pairKey(supplier_id, supplierBaseReferenceKey(supplier_sku!))),
    byPair: new Map((references.data ?? []).map((item) => [pairKey(item.supplier_id, item.product_id), item])),
    access: buildCatalogueAccess({ userId, role: tenantRole, engineersCanEditShared }),
  };
}

async function loadLatestDates({ supabase, tenantId }: AuthenticatedTenantContext, ids: string[]) {
  const prices = await readAllRowsInChunks([...new Set(ids)], (chunk) => supabase.from("supplier_pricebook")
    .select("id, supplier_catalog_item_id, valid_from", { count: "exact" })
    .eq("tenant_id", tenantId).in("supplier_catalog_item_id", chunk));
  if (prices.error) throw mapSupabaseError(prices.error, "Impossible de lire les dates des prix existants.");
  const latest = new Map<string, string>();
  for (const { supplier_catalog_item_id, valid_from } of prices.data ?? []) {
    if (valid_from > (latest.get(supplier_catalog_item_id) ?? "")) latest.set(supplier_catalog_item_id, valid_from);
  }
  return latest;
}

function asArticle({ id, reference, designation }: MatchArticle) {
  return { id, reference, designation };
}

function priceAction(
  row: SupplierBaseRow,
  known: SupplierBasePlannedRow["known_reference"],
  hasGaps: boolean,
): SupplierBasePlannedRow["price_action"] {
  if (row.unit_price_cents === null) return row.issues.includes("invalid_price") ? "review" : "none";
  if (row.price_date && known?.latest_price_date && row.price_date <= known.latest_price_date) return "skip";
  if (hasGaps || row.fragile || row.unit_price_cents === 0 || !row.price_date || !row.price_unit_code || row.issues.length > 0) return "review";
  return "add";
}

export async function buildSupplierBasePreview(
  context: AuthenticatedTenantContext,
  workbook: { rows: SupplierBaseRow[]; skipped_sheets: string[] },
): Promise<SupplierBasePreview> {
  const resolve = await loadSupplierDirectory(context);
  const names = new Set(workbook.rows.map(({ supplier_name }) => supplier_name));
  const entries = new Map([...names].map((name) => [name, resolve(name)]));
  const supplierIds = [...new Set([...entries.values()].flatMap(({ supplier_id }) => supplier_id ? [supplier_id] : []))];
  const catalogue = await loadCatalogue(context, supplierIds);
  const groups = new Map<string, SupplierBaseGroup>();

  const normalizedRows = flagDuplicateSupplierReferences(workbook.rows, (name) => entries.get(name)!.key);
  const rows = normalizedRows.map((row, index) => {
    const supplier = entries.get(row.supplier_name)!;
    const saved = supplier.supplier_id && row.supplier_reference
      ? catalogue.bySupplierSku.get(pairKey(supplier.supplier_id, supplierBaseReferenceKey(row.supplier_reference))) ?? [] : [];
    return { id: String(index), row, supplier, saved };
  });
  const latestDates = await loadLatestDates(context, rows.flatMap(({ saved }) => saved.length === 1 ? [saved[0].id] : []));

  const peers = new Map(rows.map((entry) => [entry.id, entry]));
  const workbookArticles = rows.flatMap(({ id, row }): MatchArticle[] => row.designation && row.supplier_name ? [{
    id, designation: row.designation, unit: row.price_unit_code ?? row.price_unit,
    reference: null, product_type: null, material: null, grade: null, dimensions: null,
    standard: null, aliases: [], supplier_skus: [], catalogue_status: "validated",
  }] : []);
  const workbookArticleById = new Map(workbookArticles.map((article) => [article.id, article]));
  const matchWorkbook = createSupplierBaseMatcher(workbookArticles);

  for (const { id, row, supplier, saved } of rows) {
    const group: SupplierBaseGroup = groups.get(supplier.key) ?? {
      ...supplier, workbook_names: [], known: [], proposed: [], new: [],
    };
    groups.set(supplier.key, group);
    if (row.supplier_name && !group.workbook_names.includes(row.supplier_name)) group.workbook_names.push(row.supplier_name);

    const gaps: string[] = [];
    const proposals: SupplierBaseProposal[] = [];
    let known: SupplierBasePlannedRow["known_reference"] = null;

    const line = workbookArticleById.get(id);
    const [item] = saved;
    if (saved.length === 1 && item) {
      const article = catalogue.byId.get(item.product_id);
      if (!article) {
        gaps.push("Article de la référence introuvable.");
      } else {
        const state = item.reference_needs_review ? "pending_review" : !item.is_active || !article.is_active ? "archived" : "active";
        known = { id: item.id, article: asArticle(article), state, latest_price_date: latestDates.get(item.id) ?? null };
        if (state === "pending_review") gaps.push("Référence déjà à vérifier.");
        if (state === "archived") gaps.push("Article ou référence archivé.");
        if (unitsDiffer(row.price_unit_code ?? row.price_unit, article.unit)) gaps.push(`Unité de l’article : ${article.unit}.`);
        if (!canEditCatalogueRecord(catalogue.access, article.created_by)) gaps.push("Article hors de vos droits de modification.");
      }
    } else if (saved.length > 1) {
      gaps.push("Plusieurs articles portent déjà cette référence chez ce fournisseur.");
      for (const item of saved.slice(0, 3)) {
        const article = catalogue.byId.get(item.product_id);
        if (article) proposals.push({ source: "catalogue", ...asArticle(article), gaps: [] });
      }
    } else if (line) {
      for (const match of catalogue.match(line, () => true)) {
        const article = match.article;
        const item = supplier.supplier_id ? catalogue.byPair.get(pairKey(supplier.supplier_id, article.id)) : undefined;
        const candidateGaps = [...match.gaps];
        if (item?.supplier_sku) candidateGaps.push(`Ce fournisseur a déjà une référence pour cet article (${item.supplier_sku}).`);
        else if (item && !item.is_active) candidateGaps.push("La référence de ce fournisseur est inactive.");
        if (!canEditCatalogueRecord(catalogue.access, article.created_by)) candidateGaps.push("Article hors de vos droits de modification.");
        proposals.push({ source: "catalogue", ...asArticle(article), gaps: candidateGaps });
      }
      for (const match of matchWorkbook(line, (candidate) => peers.get(candidate.id)!.supplier.key !== supplier.key, true)) {
        const peer = peers.get(match.article.id)!;
        const candidateGaps = [...match.gaps];
        if (row.packaging_label && peer.row.packaging_label
          && (workbookSupplierNameKey(row.packaging_label) !== workbookSupplierNameKey(peer.row.packaging_label)
            || row.packaging_quantity !== peer.row.packaging_quantity)) {
          candidateGaps.push("Conditionnements différents. Le conditionnement habituel sera à choisir.");
        }
        proposals.push({
          source: "workbook", sheet: peer.row.sheet, row: peer.row.row, supplier_name: peer.row.supplier_name!,
          designation: match.article.designation, gaps: candidateGaps,
        });
      }
    }

    const planned = {
      row, known_reference: known, proposals, gaps,
      price_action: priceAction(row, known, gaps.length > 0 || proposals.length > 0 || !supplier.supplier_id),
    };
    if (saved.length === 1) group.known.push(planned);
    else if (saved.length > 1 || proposals.length > 0) group.proposed.push(planned);
    else group.new.push(planned);
  }

  return { row_count: rows.length, skipped_sheets: workbook.skipped_sheets, suppliers: [...groups.values()] };
}
