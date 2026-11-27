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
  SupplierBaseGap, SupplierBaseGroup, SupplierBasePlannedRow, SupplierBasePreview, SupplierBaseProposal, SupplierBaseRow, SupplierBaseWorkbook,
} from "./supplier-base-contract";
import { createSupplierBaseMatcher, supplierBaseLinkedArticleGaps } from "./supplier-base-matching";
import { sameSupplierBaseUnitPrice } from "./supplier-base-prices";
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
    readAllRows(() => supabase.from("suppliers").select("id, name, city, email, siret, created_at, is_active", { count: "exact" })
      .eq("tenant_id", tenantId), { concurrency: 4 }),
    readAllRows(() => supabase.from("supplier_aliases").select("id, alias_key, supplier_id", { count: "exact" })
      .eq("tenant_id", tenantId), { concurrency: 4 }),
  ]);
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de lire les fournisseurs.");
  if (aliases.error) throw mapSupabaseError(aliases.error, "Impossible de lire les noms associés aux fournisseurs.");

  const directory = suppliers.data ?? [];
  const activeSuppliers = directory.filter(({ is_active }) => is_active);
  const labels = supplierPickerLabels(activeSuppliers);
  const byName = groupBy(activeSuppliers, ({ name }) => workbookSupplierNameKey(name));
  const supplierNameKeys = new Set(directory.map(({ name }) => workbookSupplierNameKey(name)));
  const aliasByName = new Map((aliases.data ?? []).map(({ alias_key, supplier_id }) => [alias_key, supplier_id]));

  // This resolution can later use the same link-or-create flow as material request workbooks.
  function resolve(name: string | null): DirectoryEntry {
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
  }
  return { resolve, isSupplierNameKey: (key: string) => supplierNameKeys.has(key) || aliasByName.has(key) };
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

async function loadPriceDates(
  { supabase, tenantId }: AuthenticatedTenantContext, ids: string[], workbookDates: ReadonlySet<string>, today: string,
) {
  // The catalogue migration backfilled this FK on every price. sync_supplier_price_catalog_item maintains it.
  const prices = await readAllRowsInChunks(ids, (chunk) => supabase.from("supplier_pricebook")
    .select("id, supplier_catalog_item_id, valid_from, is_active, unit_price_cents, unit, estimate_unit_code, estimate_units_per_purchase_unit", { count: "exact" })
    .eq("tenant_id", tenantId).eq("currency", "EUR").in("supplier_catalog_item_id", chunk));
  if (prices.error) throw mapSupabaseError(prices.error, "Impossible de lire les dates des prix existants.");
  const latestActive = new Map<string, string>();
  const onDate = groupBy(
    (prices.data ?? []).filter((price) => workbookDates.has(pairKey(price.supplier_catalog_item_id, price.valid_from))),
    (price) => pairKey(price.supplier_catalog_item_id, price.valid_from),
  );
  for (const { supplier_catalog_item_id, valid_from, is_active } of prices.data ?? []) {
    if (is_active && valid_from <= today && valid_from > (latestActive.get(supplier_catalog_item_id) ?? "")) {
      // Expiry is separate from deactivation. An expired offer still records the price observed that day.
      latestActive.set(supplier_catalog_item_id, valid_from);
    }
  }
  return { latestActive, onDate };
}

function asArticle({ id, reference, designation }: MatchArticle) {
  return { id, reference, designation };
}

function priceAction(
  row: SupplierBaseRow,
  known: SupplierBasePlannedRow["known_reference"],
  hasGaps: boolean,
): SupplierBasePlannedRow["price_action"] {
  if (!row.price) return row.issues.some((issue) => issue === "invalid_price" || issue === "text_price" || issue === "future_price_date")
    ? "review" : "none";
  if (hasGaps || row.fragile || row.price.amount_cents === null || !row.price_date || !row.price_unit_code || row.issues.length > 0) return "review";
  if (known?.latest_price_date && row.price_date <= known.latest_price_date) return "skip";
  return row.price.per === 100 ? "per_lot" : "add";
}

function flagSharedProposals(group: SupplierBaseGroup) {
  const byTarget = groupBy(group.proposed.flatMap(({ proposals }) => proposals), (proposal) =>
    proposal.source === "catalogue" ? proposal.article_id : pairKey(proposal.sheet, String(proposal.row)));
  for (const proposals of byTarget.values()) {
    if (proposals.length > 1) {
      for (const proposal of proposals) proposal.gaps.push("same_supplier_same_article");
    }
  }
}

export async function buildSupplierBasePreview(
  context: AuthenticatedTenantContext,
  workbook: SupplierBaseWorkbook,
): Promise<SupplierBasePreview> {
  const { resolve, isSupplierNameKey } = await loadSupplierDirectory(context);
  const names = new Set(workbook.rows.map(({ supplier_name }) => supplier_name));
  const entries = new Map([...names].map((name) => [name, resolve(name)]));
  const supplierNameKeys = new Set([...names].filter((name) => name !== null).map(workbookSupplierNameKey));
  const namedSupplierSheets = new Set(workbook.grouped_sheets.filter((sheet) => {
    const key = workbookSupplierNameKey(sheet);
    return isSupplierNameKey(key) || supplierNameKeys.has(key);
  }));
  const supplierIds = [...new Set([...entries.values()].flatMap(({ supplier_id }) => supplier_id ? [supplier_id] : []))];
  const catalogue = await loadCatalogue(context, supplierIds);
  const groups = new Map<string, SupplierBaseGroup>();
  const articles = new Map<string, ReturnType<typeof asArticle>>();
  function remember(article: MatchArticle) {
    if (!articles.has(article.id)) articles.set(article.id, asArticle(article));
    return article.id;
  }

  const normalizedRows = flagDuplicateSupplierReferences(workbook.rows, (name) => entries.get(name)!.key);
  const rows = normalizedRows.map((row, index) => {
    const supplier = entries.get(row.supplier_name)!;
    const saved = supplier.supplier_id && row.supplier_reference
      ? catalogue.bySupplierSku.get(pairKey(supplier.supplier_id, supplierBaseReferenceKey(row.supplier_reference))) ?? [] : [];
    return { id: String(index), row, supplier, saved };
  });
  const knownRows = rows.filter(({ saved }) => saved.length === 1);
  const workbookDates = new Set(knownRows.flatMap(({ row, saved }) => row.price_date && (row.price || row.price_text !== undefined)
    ? [pairKey(saved[0].id, row.price_date)] : []));
  const priceDates = await loadPriceDates(context, knownRows.map(({ saved }) => saved[0].id), workbookDates, workbook.today);

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

    const gaps: SupplierBaseGap[] = [];
    const proposals: SupplierBaseProposal[] = [];
    let known: SupplierBasePlannedRow["known_reference"] = null;

    const line = workbookArticleById.get(id);
    const [item] = saved;
    if (saved.length === 1 && item) {
      const article = catalogue.byId.get(item.product_id);
      if (!article) {
        gaps.push("missing_article");
      } else {
        const state = item.reference_needs_review ? "pending_review" : !item.is_active || !article.is_active ? "archived" : "active";
        known = { id: item.id, article_id: remember(article), state, latest_price_date: priceDates.latestActive.get(item.id) ?? null };
        if (state === "pending_review") gaps.push("pending_reference");
        if (state === "archived") gaps.push("archived_article_or_reference");
        if (unitsDiffer(row.price_unit_code ?? row.price_unit, article.unit)) gaps.push("unit_mismatch");
        if (!canEditCatalogueRecord(catalogue.access, article.created_by)) gaps.push("article_not_editable");
      }
    } else if (saved.length > 1) {
      gaps.push("ambiguous_reference");
      for (const item of saved) {
        const article = catalogue.byId.get(item.product_id);
        if (!article) continue;
        const candidateGaps = line ? supplierBaseLinkedArticleGaps(line, article) : [];
        if (candidateGaps === null) continue;
        if (!article.is_active || !item.is_active) candidateGaps.push("archived_article_or_reference");
        proposals.push({ source: "catalogue", article_id: remember(article), gaps: candidateGaps });
        if (proposals.length === 3) break;
      }
    } else if (line) {
      const byArticle = new Map<string, Extract<SupplierBaseProposal, { source: "catalogue" }>>();
      function proposeArticle(article: NonNullable<ReturnType<typeof catalogue.byId.get>>, candidateGaps: SupplierBaseGap[]) {
        const candidate = byArticle.get(article.id);
        if (candidate) {
          candidate.gaps = [...new Set([...candidate.gaps, ...candidateGaps])];
          return;
        }
        const existing = supplier.supplier_id ? catalogue.byPair.get(pairKey(supplier.supplier_id, article.id)) : undefined;
        if (existing?.supplier_sku) candidateGaps.push("supplier_reference_exists");
        if (existing && !existing.is_active) candidateGaps.push("supplier_reference_inactive");
        if (!article.is_active) candidateGaps.push("archived_article_or_reference");
        if (!canEditCatalogueRecord(catalogue.access, article.created_by)) candidateGaps.push("article_not_editable");
        byArticle.set(article.id, { source: "catalogue", article_id: remember(article), gaps: candidateGaps });
      }

      for (const { article, gaps } of catalogue.match(line, () => true)) {
        proposeArticle(article, gaps);
      }
      const workbookProposals: SupplierBaseProposal[] = [];
      for (const match of matchWorkbook(line, (candidate) => peers.get(candidate.id)!.supplier.key !== supplier.key, true)) {
        const peer = peers.get(match.article.id)!;
        const packagingDiffers = row.packaging_label && peer.row.packaging_label
          && (workbookSupplierNameKey(row.packaging_label) !== workbookSupplierNameKey(peer.row.packaging_label)
            || row.packaging_quantity !== peer.row.packaging_quantity);
        if (peer.saved.length > 0) {
          // A known peer can anchor an article, but its identity is never inherited through another proposal.
          if (peer.saved.length !== 1) continue;
          const [peerItem] = peer.saved;
          const target = catalogue.byId.get(peerItem.product_id);
          const targetGaps = target && supplierBaseLinkedArticleGaps(line, target);
          if (!target || !targetGaps) continue;
          if (packagingDiffers) targetGaps.push("packaging_differs");
          if (peerItem.reference_needs_review) targetGaps.push("pending_reference");
          else if (!peerItem.is_active && target.is_active) targetGaps.push("archived_article_or_reference");
          proposeArticle(target, targetGaps);
        } else {
          const candidateGaps = [...match.gaps];
          if (packagingDiffers) candidateGaps.push("packaging_differs");
          workbookProposals.push({ source: "workbook", sheet: peer.row.sheet, row: peer.row.row, gaps: candidateGaps });
        }
      }
      proposals.push(...byArticle.values(), ...workbookProposals);
    }

    const offersOnDate = known && row.price_date ? priceDates.onDate.get(pairKey(known.id, row.price_date)) ?? [] : [];
    const price = row.price;
    const differentOffer = price && offersOnDate.find((offer) => {
      const catalogueUnit = offer.estimate_unit_code ?? offer.unit;
      return unitsDiffer(row.price_unit_code ?? row.price_unit, catalogueUnit)
        || !sameSupplierBaseUnitPrice(price.unit_decimal, offer.unit_price_cents, offer.estimate_units_per_purchase_unit ?? 1);
    });
    const issues = [...row.issues];
    if (offersOnDate.some(({ is_active }) => !is_active) && !offersOnDate.some(({ is_active }) => is_active)) {
      issues.push("inactive_price_same_date");
    }
    if (differentOffer) issues.push("different_price_same_date");
    if (row.supplier_name && namedSupplierSheets.has(row.sheet)
      && workbookSupplierNameKey(row.sheet) !== workbookSupplierNameKey(row.supplier_name)) {
      issues.push("supplier_differs_from_sheet");
    }
    const normalizedRow = { ...row, issues };
    const planned = {
      row: normalizedRow, known_reference: known, proposals, gaps,
      different_catalogue_price: differentOffer ? { amount_cents: differentOffer.unit_price_cents, unit: differentOffer.unit } : undefined,
      price_action: priceAction(normalizedRow, known, gaps.length > 0 || proposals.length > 0 || !supplier.supplier_id),
    };
    if (saved.length === 1) group.known.push(planned);
    else if (proposals.length > 0) group.proposed.push(planned);
    else group.new.push(planned);
  }

  for (const group of groups.values()) flagSharedProposals(group);
  return {
    row_count: rows.length, skipped_sheets: workbook.skipped_sheets, sheet_warnings: workbook.sheet_warnings,
    articles: [...articles.values()], suppliers: [...groups.values()],
  };
}
