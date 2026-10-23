import "server-only";

import { readAllRowsInChunks } from "@/lib/supabase/read-all";

import { type SupabaseClient } from "@supabase/supabase-js";

import { isPriceStale } from "@/lib/catalogue/stale-prices";

import { getFeatureFlagValueForTenant, getStalePriceDaysForTenant } from "@/lib/feature-flags";

import {
  computeCatalogueSearchRelevance,
  isSupplierBackedCatalogueSuggestion,
  mergeCatalogueProductSuggestions,
  type CatalogueProductSuggestionRecord,
} from "@/lib/estimates/catalogue-suggestions";

import { readSupplierOfferConditions } from "@/lib/estimates/supplier-offer-conditions";

import { estimateLineUnit } from "@/lib/estimates/supplier-offer-units";

import { isSupplierOfferPriceEligible } from "@/lib/estimates/supplier-offer-price";

import {
  offerEstimateUnit,
  offerEstimateUnitPriceCents,
} from "@/lib/estimates/supplier-offer-purchase-unit";

import type { Database } from "@/types/database";

import { badRequest, mapSupabaseError } from "./errors";

import { getAuthenticatedContext, getVersionAccessOrThrow } from "./server-context";

import {
  summarizeEstimateSupplierComparisonCoverage,
  type EstimateSupplierComparison,
  buildEstimateSupplierPreselectionReview,
  buildEstimateSupplierComparisonAlternatives,
  findSelectedSupplierComparisonAlternative,
  computeEstimateSupplierComparisonRiskFlags,
  computeEstimateSupplierComparisonCoverageStatus,
  type SuggestedCataloguePrice,
  type SupplierPricebookRow,
  buildSuggestedCatalogueAlternatives,
  type HydratedSuggestedCatalogueCandidate,
  toTimestamp,
} from "./supplier-comparison";

type Supabase = SupabaseClient<Database>;

const MAX_SUPPLIER_COMPARISON_ITEMS = 200;

function normalizeSupplierPricebookRow(row: SupplierPricebookRow): SupplierPricebookRow {
  const joinedItem = Array.isArray(row.supplier_catalog_items)
    ? row.supplier_catalog_items[0] ?? null
    : row.supplier_catalog_items ?? null;

  return {
    ...row,
    supplier_sku:
      joinedItem && Object.prototype.hasOwnProperty.call(joinedItem, "supplier_sku")
        ? joinedItem.supplier_sku
        : row.supplier_sku,
    product_url:
      joinedItem && Object.prototype.hasOwnProperty.call(joinedItem, "product_url")
        ? joinedItem.product_url
        : row.product_url ?? null,
  };
}

async function resolvePreferredSupplierIdForCandidates(input: {
  supabase: Supabase;
  tenantId: string;
  supplierPrices: SupplierPricebookRow[];
}) {
  const preferredSupplierValue = await getFeatureFlagValueForTenant(
    input.tenantId,
    "PREFERRED_SUPPLIER_ID",
    { supabase: input.supabase }
  );

  if (preferredSupplierValue && /^[0-9a-fA-F-]{36}$/.test(preferredSupplierValue)) {
    return preferredSupplierValue;
  }

  const supplierFrequency = new Map<string, number>();
  input.supplierPrices.forEach((row) => {
    supplierFrequency.set(
      row.supplier_id,
      (supplierFrequency.get(row.supplier_id) ?? 0) + 1
    );
  });

  return (
    [...supplierFrequency.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null
  );
}

async function hydrateSuggestedCatalogueCandidates(input: {
  supabase: Supabase;
  tenantId: string;
  supplierPrices: SupplierPricebookRow[];
  stalePriceDays: number;
  query: string;
  filterByRelevance: boolean;
}) {
  if (input.supplierPrices.length === 0) {
    return [] as HydratedSuggestedCatalogueCandidate[];
  }

  const productById = new Map<string, CatalogueProductSuggestionRecord>();
  const supplierById = new Map<string, { id: string; name: string }>();

  const productIds = Array.from(new Set(input.supplierPrices.map((row) => row.product_id)));
  if (productIds.length > 0) {
    const { data: productsData, error: productsError } = await input.supabase
      .from("products")
      .select(
        "id, designation, reference, category, product_type, material, grade, dimensions, standard, unit, unit_price_cents, updated_at"
      )
      .eq("tenant_id", input.tenantId)
      .in("id", productIds);

    if (productsError) {
      throw mapSupabaseError(
        productsError,
        "Impossible de charger les produits des suggestions."
      );
    }

    ((productsData ?? []) as unknown as CatalogueProductSuggestionRecord[]).forEach((product) => {
      productById.set(product.id, product);
    });
  }

  const supplierIds = Array.from(new Set(input.supplierPrices.map((row) => row.supplier_id)));
  if (supplierIds.length > 0) {
    const { data: suppliersData, error: suppliersError } = await input.supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", input.tenantId)
      .in("id", supplierIds);

    if (suppliersError) {
      throw mapSupabaseError(
        suppliersError,
        "Impossible de charger les fournisseurs des suggestions."
      );
    }

    ((suppliersData ?? []) as Array<{ id: string; name: string }>).forEach((supplier) => {
      supplierById.set(supplier.id, supplier);
    });
  }

  const supplierPriceIds = input.supplierPrices.map((row) => row.id);
  const materialIndexBySupplierPriceId = new Map<
    string,
    {
      index_code: string;
      index_value: number;
      updated_at: string;
      index_date: string;
    }
  >();

  if (supplierPriceIds.length > 0) {
    const { data: linksData, error: linksError } = await readAllRowsInChunks(supplierPriceIds, (pageIds) => input.supabase
      .from("dpgf_catalogue_links")
      .select("supplier_price_id, material_index_id, id", { count: "exact" })
      .eq("tenant_id", input.tenantId)
      .in("supplier_price_id", pageIds));

    if (linksError) {
      throw mapSupabaseError(
        linksError,
        "Impossible de charger les liaisons catalogue des suggestions."
      );
    }

    const links = (linksData ?? []) as Array<{
      supplier_price_id: string | null;
      material_index_id: string | null;
    }>;
    const materialIndexIds = Array.from(
      new Set(
        links
          .map((link) => link.material_index_id)
          .filter((value): value is string => typeof value === "string")
      )
    );

    if (materialIndexIds.length > 0) {
      const { data: indicesData, error: indicesError } = await readAllRowsInChunks(materialIndexIds, (pageIds) => input.supabase
        .from("material_indices")
        .select("id, index_code, index_value, updated_at, index_date", { count: "exact" })
        .eq("tenant_id", input.tenantId)
        .in("id", pageIds));

      if (indicesError) {
        throw mapSupabaseError(
          indicesError,
          "Impossible de charger les indices matériaux des suggestions."
        );
      }

      const indexById = new Map(
        ((indicesData ?? []) as Array<{
          id: string;
          index_code: string;
          index_value: number;
          updated_at: string;
          index_date: string;
        }>).map((index) => [index.id, index])
      );

      links.forEach((link) => {
        if (!link.supplier_price_id || !link.material_index_id) return;
        const index = indexById.get(link.material_index_id);
        if (!index) return;
        materialIndexBySupplierPriceId.set(link.supplier_price_id, index);
      });
    }
  }

  const now = new Date();

  return input.supplierPrices
    .map((row) => {
      const product = productById.get(row.product_id);
      const supplier = supplierById.get(row.supplier_id);
      const materialIndex = materialIndexBySupplierPriceId.get(row.id);
      const hasMaterialIndexAdjustment =
        typeof materialIndex?.index_value === "number" && materialIndex.index_value > 0;
      // 2.9: a converted offer prices the estimate per estimate unit (bar of 3 m at 262,45 € → 87,48 €/ml).
      const adjustedPurchaseUnitPriceCents = hasMaterialIndexAdjustment
        ? Math.round((row.unit_price_cents * materialIndex.index_value) / 100)
        : row.unit_price_cents;
      const adjustedUnitPriceCents = offerEstimateUnitPriceCents(row, adjustedPurchaseUnitPriceCents);
      const updatedAt = row.updated_at ?? row.created_at ?? null;
      const relevanceScore = computeCatalogueSearchRelevance({
        query: input.query,
        designation: product?.designation ?? "",
        supplierName: supplier?.name ?? "",
        supplierSku: row.supplier_sku ?? null,
        productReference: product?.reference ?? null,
        category: product?.category ?? null,
        productType: product?.product_type ?? null,
        material: product?.material ?? null,
        grade: product?.grade ?? null,
        dimensions: product?.dimensions ?? null,
        standard: product?.standard ?? null,
      });

      return {
        price_source: "supplier",
        supplier_price_id: row.id,
        product_id: row.product_id,
        product_designation: product?.designation ?? "Produit",
        product_reference: product?.reference ?? null,
        product_category: product?.category ?? null,
        product_type: product?.product_type ?? null,
        product_material: product?.material ?? null,
        product_grade: product?.grade ?? null,
        product_dimensions: product?.dimensions ?? null,
        product_standard: product?.standard ?? null,
        supplier_id: row.supplier_id,
        supplier_name: supplier?.name ?? "Fournisseur",
        supplier_reference: row.supplier_sku ?? null,
        unit: offerEstimateUnit(row),
        unit_price_cents: row.unit_price_cents,
        adjusted_unit_price_cents: adjustedUnitPriceCents,
        currency: row.currency ?? null,
        updated_at: updatedAt,
        is_stale: isPriceStale(
          { updatedAt, createdAt: row.created_at ?? null },
          input.stalePriceDays,
          now
        ),
        stale_days: input.stalePriceDays,
        relevance_score: relevanceScore,
        has_material_index_adjustment: hasMaterialIndexAdjustment,
        material_index_code: materialIndex?.index_code ?? null,
        material_index_value: materialIndex?.index_value ?? null,
        catalogue_url: row.product_url ?? extractCatalogueUrl(row.notes),
        zero_price_kind: row.zero_price_kind ?? null,
        purchase_unit: row.unit ?? null,
        adjusted_purchase_unit_price_cents: adjustedPurchaseUnitPriceCents,
        estimate_unit_code: row.estimate_unit_code ?? null,
        estimate_units_per_purchase_unit: row.estimate_units_per_purchase_unit ?? null,
        purchase_rounding: row.purchase_rounding ?? null,
      } satisfies HydratedSuggestedCatalogueCandidate;
    })
    .filter((candidate) =>
      input.filterByRelevance ? candidate.relevance_score > 0 : true
    )
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }
      return toTimestamp(right.updated_at) - toTimestamp(left.updated_at);
    });
}

async function findSelectedSupplierComparisonCandidate(input: {
  supabase: Supabase;
  tenantId: string;
  selectedSupplierPriceId: string;
  stalePriceDays: number;
}) {
  const { data: selectedPriceData, error: selectedPriceError } = await input.supabase
    .from("supplier_pricebook")
    .select(
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, zero_price_kind, estimate_unit_code, estimate_units_per_purchase_unit, purchase_rounding, currency, updated_at, created_at, notes, is_active, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku, product_url)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.selectedSupplierPriceId)
    .maybeSingle();

  if (selectedPriceError) {
    throw mapSupabaseError(
      selectedPriceError,
      "Impossible de charger la sélection fournisseur actuelle."
    );
  }

  const selectedPrice = selectedPriceData
    ? normalizeSupplierPricebookRow(selectedPriceData as unknown as SupplierPricebookRow)
    : null;
  if (!selectedPrice) {
    return null;
  }

  const { data: productPriceData, error: productPriceError } = await input.supabase
    .from("supplier_pricebook")
    .select(
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, zero_price_kind, estimate_unit_code, estimate_units_per_purchase_unit, purchase_rounding, currency, updated_at, created_at, notes, is_active, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku, product_url)"
    )
    .eq("tenant_id", input.tenantId)
    .eq("product_id", selectedPrice.product_id)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(400);

  if (productPriceError) {
    throw mapSupabaseError(
      productPriceError,
      "Impossible de charger les alternatives de la sélection fournisseur."
    );
  }

  const selectedAndPeerRows = Array.from(
    new Map(
      [
        selectedPrice,
        // A7: a peer offer at 0 € that is not marked never becomes an alternative; the
        // selected offer stays, so a line already linked to one is shown, not rewritten.
        ...((productPriceData ?? []) as unknown as SupplierPricebookRow[]).map(
          normalizeSupplierPricebookRow
        ).filter(isSupplierOfferPriceEligible),
      ].map(
        (row) => [row.id, row] as const
      )
    ).values()
  );
  const selectedAndPeerRowsById = new Map(
    selectedAndPeerRows.map((row) => [row.id, row] as const)
  );
  const preferredSupplierId = await resolvePreferredSupplierIdForCandidates({
    supabase: input.supabase,
    tenantId: input.tenantId,
    supplierPrices: selectedAndPeerRows.filter((row) => row.is_active),
  });
  const candidates = await hydrateSuggestedCatalogueCandidates({
    supabase: input.supabase,
    tenantId: input.tenantId,
    supplierPrices: selectedAndPeerRows,
    stalePriceDays: input.stalePriceDays,
    query: "",
    filterByRelevance: false,
  });
  const selectedCandidate =
    candidates.find(
      (candidate) => candidate.supplier_price_id === input.selectedSupplierPriceId
    ) ?? null;

  if (!selectedCandidate) {
    return null;
  }

  // A7: an ineligible selected offer stays the candidate (shown as the current choice) but never
  // ranks as best price, most recent or preferred supplier against eligible peers.
  const productCandidates = candidates.filter((candidate) => {
    const row = selectedAndPeerRowsById.get(candidate.supplier_price_id);
    return candidate.product_id === selectedCandidate.product_id && row?.is_active === true &&
      isSupplierOfferPriceEligible(candidate);
  });

  return {
    ...selectedCandidate,
    supplier_offer_count: productCandidates.length,
    alternatives: buildSuggestedCatalogueAlternatives({
      productCandidates,
      preferredSupplierId,
    }),
  } satisfies SuggestedCataloguePrice;
}

function escapeIlikeToken(value: string) {
  return value.replace(/[%_,()']/g, "");
}

function normalizeSupplierComparisonQuery(value: string | null | undefined) {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractCatalogueUrl(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/https?:\/\/[^\s]+/i);
  if (!match?.[0]) return null;
  return match[0];
}

export async function suggestEstimateCataloguePrices(
  versionId: string,
  query: string
) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    throw badRequest("Le paramètre q doit contenir au moins 2 caractères.");
  }

  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  await getVersionAccessOrThrow(supabase, versionId, context);

  const stalePriceDays = await getStalePriceDaysForTenant(tenantId, { supabase });
  const safeSearch = escapeIlikeToken(normalizedQuery);
  if (safeSearch.length < 2) {
    throw badRequest("Le paramètre q contient uniquement des caractères non supportés.");
  }

  const productColumns =
    "id, designation, reference, category, product_type, material, grade, dimensions, standard, unit, unit_price_cents, updated_at";
  const productContainsFilter = `designation.ilike.%${safeSearch}%,reference.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%,product_type.ilike.%${safeSearch}%,material.ilike.%${safeSearch}%,grade.ilike.%${safeSearch}%,dimensions.ilike.%${safeSearch}%,standard.ilike.%${safeSearch}%`;
  const productPrefixFilter = `designation.ilike.${safeSearch}%,reference.ilike.${safeSearch}%`;

  const [prefixProductResult, productResult, supplierResult] = await Promise.all([
    supabase
      .from("products")
      .select(productColumns)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .or(productPrefixFilter)
      .order("designation", { ascending: true })
      .limit(40),
    supabase
      .from("products")
      .select(productColumns)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .or(productContainsFilter)
      .order("designation", { ascending: true })
      .limit(80),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${safeSearch}%`)
      .limit(40),
  ]);

  const productError = prefixProductResult.error ?? productResult.error;
  if (productError) {
    throw mapSupabaseError(
      productError,
      "Impossible de charger les produits catalogue."
    );
  }
  if (supplierResult.error) {
    throw mapSupabaseError(
      supplierResult.error,
      "Impossible de charger les fournisseurs catalogue."
    );
  }

  const matchingProducts = [
    ...(prefixProductResult.data ?? []),
    ...(productResult.data ?? []),
  ] as unknown as CatalogueProductSuggestionRecord[];
  const products = Array.from(
    new Map(matchingProducts.map((product) => [product.id, product])).values()
  );
  const suppliers = (supplierResult.data ?? []) as Array<{
    id: string;
    name: string;
  }>;

  const productIds = products.map((product) => product.id);
  const supplierIds = suppliers.map((supplier) => supplier.id);

  const filterClauses: string[] = [];
  if (productIds.length > 0) {
    filterClauses.push(`product_id.in.(${productIds.join(",")})`);
  }
  if (supplierIds.length > 0) {
    filterClauses.push(`supplier_id.in.(${supplierIds.join(",")})`);
  }
  if (safeSearch.length > 0) {
    filterClauses.push(`supplier_sku.ilike.%${safeSearch}%`);
  }

  if (filterClauses.length === 0) {
    return {
      query: normalizedQuery,
      stale_price_days: stalePriceDays,
      suggestions: [] as SuggestedCataloguePrice[],
    };
  }

  let supplierPricesQuery = supabase
    .from("supplier_pricebook")
    .select(
      "id, supplier_id, product_id, supplier_sku, unit, unit_price_cents, zero_price_kind, estimate_unit_code, estimate_units_per_purchase_unit, purchase_rounding, currency, updated_at, created_at, notes, is_active, supplier_catalog_items!supplier_pricebook_supplier_catalog_item_id_fkey(supplier_sku, product_url)"
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(400);

  supplierPricesQuery = supplierPricesQuery.or(filterClauses.join(","));

  const { data: supplierPricesData, error: supplierPricesError } = await supplierPricesQuery;

  if (supplierPricesError) {
    throw mapSupabaseError(
      supplierPricesError,
      "Impossible de charger les suggestions de prix catalogue."
    );
  }

  // A7: an unmarked offer at 0 € never becomes a suggestion, a best price or a preselection.
  const supplierPrices = ((supplierPricesData ?? []) as unknown as SupplierPricebookRow[]).map(
    normalizeSupplierPricebookRow
  ).filter(isSupplierOfferPriceEligible);

  const preferredSupplierId =
    supplierPrices.length > 0
      ? await resolvePreferredSupplierIdForCandidates({
          supabase,
          tenantId,
          supplierPrices,
        })
      : null;
  const candidates =
    supplierPrices.length > 0
      ? await hydrateSuggestedCatalogueCandidates({
          supabase,
          tenantId,
          supplierPrices,
          stalePriceDays,
          query: normalizedQuery,
          filterByRelevance: true,
        })
      : [];

  const candidatesByProductId = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => {
    const productCandidates = candidatesByProductId.get(candidate.product_id) ?? [];
    productCandidates.push(candidate);
    candidatesByProductId.set(candidate.product_id, productCandidates);
  });

  const supplierSuggestions = Array.from(candidatesByProductId.values()).map(
    (productCandidates) => {
      const candidate = productCandidates[0]!;
      return {
        ...candidate,
        supplier_offer_count: productCandidates.length,
        alternatives: buildSuggestedCatalogueAlternatives({
          productCandidates,
          preferredSupplierId,
        }),
      };
    }
  ) satisfies SuggestedCataloguePrice[];
  const suggestions = mergeCatalogueProductSuggestions({
    query: normalizedQuery,
    stalePriceDays,
    products,
    supplierSuggestions,
  });

  return {
    query: normalizedQuery,
    stale_price_days: stalePriceDays,
    suggestions,
  };
}

export async function getEstimateSupplierComparisons(
  versionId: string,
  itemIds: string[] | null
) {
  const normalizedItemIds =
    itemIds === null
      ? null
      : Array.from(
          new Set(itemIds.map((itemId) => itemId.trim()).filter((itemId) => itemId.length > 0))
        );

  if (normalizedItemIds !== null) {
    if (normalizedItemIds.length === 0) {
      throw badRequest("item_ids ne peut pas être vide.");
    }
    if (normalizedItemIds.length > MAX_SUPPLIER_COMPARISON_ITEMS) {
      throw badRequest("item_ids ne peut pas contenir plus de 200 identifiants.");
    }
  }

  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;
  const { version: accessedVersion } = await getVersionAccessOrThrow(
    supabase,
    versionId,
    context
  );

  // Devise du devis : un prix fournisseur libellé dans une autre devise ne doit
  // jamais être préselectionné automatiquement, son montant étant écrit tel quel
  // dans unit_price_ht_cents.
  const estimateCurrency = accessedVersion.currency?.trim() || "EUR";

  let itemsQuery = supabase
    .from("estimate_items")
    .select("id, item_type, title, quantity, description, unit_code, selected_supplier_price_id")
    .eq("tenant_id", tenantId)
    .eq("version_id", versionId);

  if (normalizedItemIds === null) {
    itemsQuery = itemsQuery.eq("item_type", "line");
  } else {
    itemsQuery = itemsQuery.in("id", normalizedItemIds);
  }

  const { data: rows, error } = await itemsQuery;

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les lignes.");
  }

  const items = (rows ?? []) as Array<{
    id: string;
    item_type: Database["public"]["Enums"]["estimate_item_type"];
    title: string;
    quantity: number;
    description: string | null;
    unit_code?: string | null;
    selected_supplier_price_id: string | null;
  }>;
  const lineItems = items.filter((item) => item.item_type === "line");
  const itemById = new Map(lineItems.map((item) => [item.id, item]));
  const resolvedItemIds = normalizedItemIds ?? lineItems.map((item) => item.id);

  if (
    normalizedItemIds === null &&
    resolvedItemIds.length > MAX_SUPPLIER_COMPARISON_ITEMS
  ) {
    throw badRequest("all_items ne peut pas charger plus de 200 lignes.");
  }

  if (normalizedItemIds !== null) {
    normalizedItemIds.forEach((itemId) => {
      const item = itemById.get(itemId);
      if (!item) {
        throw badRequest("item_id doit correspondre a une ligne de devis.", {
          item_id: itemId,
        });
      }
    });
  }

  const stalePriceDays = await getStalePriceDaysForTenant(tenantId, { supabase });

  if (resolvedItemIds.length === 0) {
    return {
      stale_price_days: stalePriceDays,
      coverage_summary: summarizeEstimateSupplierComparisonCoverage([]),
      comparisons: [] as EstimateSupplierComparison[],
      bulk_preselection: buildEstimateSupplierPreselectionReview({
        comparisons: [],
        itemTitleById: new Map(),
        estimateCurrency,
      }),
    };
  }

  const queryByNormalizedKey = new Map<string, string>();
  const normalizedKeyByItemId = new Map<string, string>();

  resolvedItemIds.forEach((itemId) => {
    const item = itemById.get(itemId);
    if (!item) return;

    const normalizedQuery = normalizeSupplierComparisonQuery(item.title);
    normalizedKeyByItemId.set(itemId, normalizedQuery);

    if (normalizedQuery.length < 2) return;
    if (escapeIlikeToken(normalizedQuery).length < 2) return;
    if (!queryByNormalizedKey.has(normalizedQuery)) {
      queryByNormalizedKey.set(normalizedQuery, normalizedQuery);
    }
  });

  const suggestionsEntries = await Promise.all(
    Array.from(queryByNormalizedKey.entries()).map(async ([normalizedQuery, query]) => {
      const suggestion = await suggestEstimateCataloguePrices(versionId, query);
      return [normalizedQuery, suggestion] as const;
    })
  );
  const suggestionsByNormalizedQuery = new Map(suggestionsEntries);

  const comparisons = await Promise.all(resolvedItemIds.map(async (itemId): Promise<EstimateSupplierComparison> => {
    const item = itemById.get(itemId);
    if (!item) {
      return {
        item_id: itemId,
        selected_supplier_price_id: null,
        best_supplier_price_id: null,
        coverage_status: "no_price",
        risk_flags: [],
        selected_alternative: null,
        alternatives: [],
      } satisfies EstimateSupplierComparison;
    }

    const normalizedKey = normalizedKeyByItemId.get(itemId) ?? "";
    const suggestions = (
      suggestionsByNormalizedQuery.get(normalizedKey)?.suggestions ?? []
    ).filter(isSupplierBackedCatalogueSuggestion);

    const selectedSupplierPriceId = item.selected_supplier_price_id ?? null;
    const selectedSuggestion = selectedSupplierPriceId
      ? suggestions.find((suggestion) => {
          if (suggestion.supplier_price_id === selectedSupplierPriceId) return true;
          return suggestion.alternatives.some(
            (alternative) => alternative.supplier_price_id === selectedSupplierPriceId
          );
        }) ?? null
      : null;
    const candidate =
      selectedSuggestion ??
      (selectedSupplierPriceId
        ? await findSelectedSupplierComparisonCandidate({
            supabase,
            tenantId,
            selectedSupplierPriceId,
            stalePriceDays,
          })
        : null) ??
      suggestions[0] ??
      null;

    if (!candidate) {
      return {
        item_id: item.id,
        selected_supplier_price_id: selectedSupplierPriceId,
        best_supplier_price_id: null,
        coverage_status: "no_price",
        risk_flags: [],
        selected_alternative: null,
        alternatives: [],
      } satisfies EstimateSupplierComparison;
    }

    const bestAlternative =
      candidate.alternatives.find((alternative) => alternative.kind === "best_price") ?? null;
    const alternatives = buildEstimateSupplierComparisonAlternatives({
      candidate: {
        supplier_price_id: candidate.supplier_price_id,
        supplier_id: candidate.supplier_id,
        supplier_name: candidate.supplier_name,
        adjusted_unit_price_cents: candidate.adjusted_unit_price_cents,
        adjusted_purchase_unit_price_cents: candidate.adjusted_purchase_unit_price_cents ?? null,
        currency: candidate.currency ?? null,
        supplier_reference: candidate.supplier_reference,
        catalogue_url: candidate.catalogue_url,
        updated_at: candidate.updated_at,
        is_stale: candidate.is_stale,
        product_designation: candidate.product_designation,
        alternatives: candidate.alternatives,
      },
      selectedSupplierPriceId,
    });
    const selectedAlternative = findSelectedSupplierComparisonAlternative(
      alternatives,
      selectedSupplierPriceId
    );
    const riskFlags = computeEstimateSupplierComparisonRiskFlags({
      alternatives,
      selectedSupplierPriceId,
      bestSupplierPriceId: bestAlternative?.supplier_price_id ?? null,
      selectedAlternative,
    });

    return {
      item_id: item.id,
      selected_supplier_price_id: selectedSupplierPriceId,
      best_supplier_price_id: bestAlternative?.supplier_price_id ?? null,
      // Computed below, once each offer's price and marking are merged.
      coverage_status: "no_price",
      risk_flags: riskFlags,
      selected_alternative: selectedAlternative,
      alternatives,
    } satisfies EstimateSupplierComparison;
  }));

  const conditions = await readSupplierOfferConditions(supabase, tenantId,
    comparisons.flatMap((comparison) => comparison.alternatives.map((alternative) => alternative.supplier_price_id)));
  comparisons.forEach((comparison) => {
    const item = itemById.get(comparison.item_id);
    // The unit of the line: unit_code on an engine 3 line (M4), description otherwise.
    Object.assign(comparison, { quantity: item?.quantity, unit: item ? estimateLineUnit(item) : undefined });
    comparison.alternatives.forEach((alternative) => {
      Object.assign(alternative, conditions.get(alternative.supplier_price_id) ?? { is_active: false });
    });
    comparison.coverage_status = computeEstimateSupplierComparisonCoverageStatus({
      alternatives: comparison.alternatives,
      selectedAlternative: comparison.selected_alternative,
      riskFlags: comparison.risk_flags,
    });
  });

  const itemTitleById = new Map(lineItems.map((item) => [item.id, item.title]));

  return {
    stale_price_days: stalePriceDays,
    coverage_summary: summarizeEstimateSupplierComparisonCoverage(comparisons),
    comparisons,
    bulk_preselection: buildEstimateSupplierPreselectionReview({
      comparisons,
      itemTitleById,
      estimateCurrency,
    }),
  };
}
