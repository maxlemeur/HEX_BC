import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { maxPriceValidTo } from "@/lib/catalogue/price-validity";
import { normalizedReference } from "@/lib/catalogue/product-price-template-client";

import { PRODUCT_UNIT_HAS_PACKAGINGS, isProductUnitHeldByPackagings } from "@/lib/catalogue/packagings";
import { matchSupplyTypeByName } from "@/lib/catalogue/supply-types";
import { listSupplyTypes } from "@/lib/catalogue/supply-types-server";
import { CatalogueApiError } from "@/lib/catalogue/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeSupabase = SupabaseClient<any>;

const MAX_TEMPLATE_ROWS = 5000;
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const nullableTextSchema = (max: number) => z.string().trim().max(max).nullable();

const productTemplateRowSchema = z.object({
  reference: z.string().trim().min(1).max(255),
  designation: z.string().trim().min(1).max(500),
  family: nullableTextSchema(255),
  product_type: nullableTextSchema(255),
  material: nullableTextSchema(255),
  grade: nullableTextSchema(255),
  dimensions: nullableTextSchema(255),
  standard: nullableTextSchema(255),
  unit: z.string().trim().min(1).max(50),
  unit_price_cents: z.number().int().min(0),
  is_active: z.literal(true),
});

const supplierPriceTemplateRowSchema = z.object({
  product_reference: z.string().trim().min(1).max(255),
  supplier_name: z.string().trim().min(1).max(255),
  supplier_sku: nullableTextSchema(255),
  unit_price_cents: z.number().int().positive(),
  unit: z.string().trim().min(1).max(50),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  valid_from: isoDateSchema,
  min_quantity: z.number().positive().max(999999999),
  source_url: z.string().trim().url().max(2000).nullable(),
  comment: nullableTextSchema(2000),
});

export const productPriceTemplateImportSchema = z
  .object({
    products: z.array(productTemplateRowSchema).max(MAX_TEMPLATE_ROWS),
    prices: z.array(supplierPriceTemplateRowSchema).max(MAX_TEMPLATE_ROWS),
  })
  .refine((value) => value.products.length + value.prices.length > 0, {
    message: "Le fichier ne contient aucune ligne à importer.",
  });

export type ProductPriceTemplateImportInput = z.infer<typeof productPriceTemplateImportSchema>;

type ExistingProduct = {
  id: string;
  reference: string | null;
  unit: string;
};

type ExistingSupplier = {
  id: string;
  name: string;
};

export type ProductPriceTemplateImportResult = {
  created_products: number;
  updated_products: number;
  created_prices: number;
  skipped_prices: number;
};

function normalizedSupplierName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildUniqueLookup<T>(
  items: T[],
  valueOf: (item: T) => string | null,
  normalize: (value: string) => string
): { values: Map<string, T>; ambiguous: Set<string> } {
  const values = new Map<string, T>();
  const ambiguous = new Set<string>();

  for (const item of items) {
    const rawValue = valueOf(item);
    if (!rawValue) continue;
    const token = normalize(rawValue);
    if (!token) continue;
    if (values.has(token)) {
      ambiguous.add(token);
      continue;
    }
    values.set(token, item);
  }

  return { values, ambiguous };
}

function mapDatabaseError(error: PostgrestError, fallbackMessage: string) {
  const message = `${error.message ?? ""} ${error.details ?? ""}`.toLocaleLowerCase("fr-FR");
  if (isProductUnitHeldByPackagings(error)) {
    return new CatalogueApiError({
      status: 409,
      code: PRODUCT_UNIT_HAS_PACKAGINGS,
      message:
        "Un article du fichier a des conditionnements de vente : retirez-les avant de changer son unité, leurs quantités sont exprimées dans l’unité actuelle.",
    });
  }
  if (error.code === "42501" || message.includes("row-level security")) {
    return new CatalogueApiError({
      status: 403,
      code: "FORBIDDEN",
      message: "Vous n'avez pas les droits nécessaires pour importer ce fichier.",
    });
  }

  return new CatalogueApiError({
    status: 400,
    code: "TEMPLATE_IMPORT_FAILED",
    message: fallbackMessage,
    details: error,
  });
}

async function getAuthenticatedSupabase(): Promise<RuntimeSupabase> {
  const typedClient = await createSupabaseServerClient();
  const supabase = typedClient as unknown as RuntimeSupabase;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new CatalogueApiError({
      status: 401,
      code: "UNAUTHORIZED",
      message: "Authentification requise.",
    });
  }

  return supabase;
}

/**
 * The unit of an article that has sale packagings does not change (foreign key ON UPDATE RESTRICT). Checked before
 * any write, so the file is refused as a whole, naming up to five of those articles; a packaging added after this
 * check is still refused by the database, and mapDatabaseError words that refusal.
 */
async function refuseUnitChangesOfArticlesWithPackagings(
  supabase: RuntimeSupabase,
  products: ReadonlyArray<{ reference: string; unit: string }>,
  existingByReference: ReadonlyMap<string, ExistingProduct>,
) {
  const changing = new Map<string, ExistingProduct>();
  for (const product of products) {
    const existing = existingByReference.get(normalizedReference(product.reference));
    if (existing && existing.unit !== product.unit) changing.set(existing.id, existing);
  }
  if (changing.size === 0) return;

  const { data, error } = await readAllRowsInChunks([...changing.keys()], (chunk) => supabase
    .from("product_packagings")
    .select("id, product_id", { count: "exact" })
    .in("product_id", chunk));
  if (error) throw mapDatabaseError(error, "Impossible de vérifier les conditionnements des produits du fichier.");

  // In the order of the file.
  const withPackagings = new Set(((data ?? []) as Array<{ product_id: string }>).map((row) => row.product_id));
  const held = [...changing.values()]
    .filter((product) => withPackagings.has(product.id))
    .map((product) => product.reference ?? product.id);
  if (held.length === 0) return;

  const others = held.length - 5;
  throw new CatalogueApiError({
    status: 409,
    code: PRODUCT_UNIT_HAS_PACKAGINGS,
    message: `Retirez les conditionnements de vente avant de changer l’unité de ces articles : ${held.slice(0, 5).join(", ")}${
      others > 0 ? ` et ${others} autre${others > 1 ? "s" : ""}` : ""}.`,
    details: { references: held },
  });
}

export async function importProductPriceTemplate(
  rawInput: ProductPriceTemplateImportInput
): Promise<ProductPriceTemplateImportResult> {
  const input = productPriceTemplateImportSchema.parse(rawInput);
  const supabase = await getAuthenticatedSupabase();

  const namesFamilies = input.products.some((product) => product.family);
  const [productsResult, suppliersResult, supplyTypes] = await Promise.all([
    readAllRows(() => supabase.from("products").select("id, reference, unit", { count: "exact" })),
    readAllRows(() => supabase.from("suppliers").select("id, name", { count: "exact" }).eq("is_active", true)),
    // Row policies show a member the supply types of every company they belong to: this read is the active one's.
    namesFamilies ? listSupplyTypes().then((answer) => answer.items) : [],
  ]);

  if (productsResult.error) {
    throw mapDatabaseError(productsResult.error, "Impossible de vérifier les produits existants.");
  }
  if (suppliersResult.error) {
    throw mapDatabaseError(suppliersResult.error, "Impossible de vérifier les fournisseurs existants.");
  }

  const existingProducts = (productsResult.data ?? []) as ExistingProduct[];
  const existingSuppliers = (suppliersResult.data ?? []) as ExistingSupplier[];
  const productLookup = buildUniqueLookup(
    existingProducts,
    (product) => product.reference,
    normalizedReference
  );
  const supplierLookup = buildUniqueLookup(
    existingSuppliers,
    (supplier) => supplier.name,
    normalizedSupplierName
  );
  const incomingProductLookup = buildUniqueLookup(
    input.products,
    (product) => product.reference,
    normalizedReference
  );

  const ambiguousProducts = new Set<string>();
  const unknownProducts = new Set<string>();
  const ambiguousSuppliers = new Set<string>();
  const unknownSuppliers = new Set<string>();
  const ambiguousFamilies = new Set<string>();
  const unknownFamilies = new Set<string>();
  // The family a row names is one of the company's supply types.
  const supplyTypeIdByFamily = new Map<string, string>();

  for (const product of input.products) {
    if (product.family && !supplyTypeIdByFamily.has(product.family)) {
      const match = matchSupplyTypeByName(supplyTypes, product.family);
      if (match.status === "found") supplyTypeIdByFamily.set(product.family, match.id);
      else if (match.status === "ambiguous") ambiguousFamilies.add(product.family);
      else unknownFamilies.add(product.family);
    }
    const productToken = normalizedReference(product.reference);
    if (
      incomingProductLookup.ambiguous.has(productToken) ||
      productLookup.ambiguous.has(productToken)
    ) {
      ambiguousProducts.add(product.reference);
    }
  }

  for (const price of input.prices) {
    const productToken = normalizedReference(price.product_reference);
    const supplierToken = normalizedSupplierName(price.supplier_name);

    if (
      productLookup.ambiguous.has(productToken) ||
      incomingProductLookup.ambiguous.has(productToken)
    ) {
      ambiguousProducts.add(price.product_reference);
    } else if (
      !productLookup.values.has(productToken) &&
      !incomingProductLookup.values.has(productToken)
    ) {
      unknownProducts.add(price.product_reference);
    }

    if (supplierLookup.ambiguous.has(supplierToken)) {
      ambiguousSuppliers.add(price.supplier_name);
    } else if (!supplierLookup.values.has(supplierToken)) {
      unknownSuppliers.add(price.supplier_name);
    }
  }

  if (
    ambiguousProducts.size > 0 ||
    unknownProducts.size > 0 ||
    ambiguousSuppliers.size > 0 ||
    unknownSuppliers.size > 0 ||
    ambiguousFamilies.size > 0 ||
    unknownFamilies.size > 0
  ) {
    throw new CatalogueApiError({
      status: 400,
      code: "TEMPLATE_REFERENCES_UNRESOLVED",
      message: [
        unknownProducts.size > 0
          ? `Produits inconnus: ${Array.from(unknownProducts).slice(0, 5).join(", ")}`
          : null,
        ambiguousProducts.size > 0
          ? `Produits ambigus: ${Array.from(ambiguousProducts).slice(0, 5).join(", ")}`
          : null,
        unknownSuppliers.size > 0
          ? `Fournisseurs inconnus: ${Array.from(unknownSuppliers).slice(0, 5).join(", ")}`
          : null,
        ambiguousSuppliers.size > 0
          ? `Fournisseurs ambigus: ${Array.from(ambiguousSuppliers).slice(0, 5).join(", ")}`
          : null,
        unknownFamilies.size > 0
          ? `Familles inconnues du catalogue: ${Array.from(unknownFamilies).slice(0, 5).join(", ")}`
          : null,
        ambiguousFamilies.size > 0
          ? `Familles ambiguës: ${Array.from(ambiguousFamilies).slice(0, 5).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  await refuseUnitChangesOfArticlesWithPackagings(supabase, input.products, productLookup.values);

  let createdProducts = 0;
  let updatedProducts = 0;

  if (input.products.length > 0) {
    const productsToCreate: Array<Record<string, unknown>> = [];
    // An update whose row names no family does not send the column at all: writing back the family read above
    // would undo a reclassification made in the catalogue meanwhile. One statement takes rows of the same columns.
    const productsToUpdate: Array<Record<string, unknown>> = [];
    const productsToReclassify: Array<Record<string, unknown>> = [];

    for (const product of input.products) {
      const existing = productLookup.values.get(normalizedReference(product.reference));
      if (existing) updatedProducts += 1;
      else createdProducts += 1;

      const payload = {
        ...(existing ? { id: existing.id } : {}),
        reference: existing?.reference ?? product.reference,
        designation: product.designation,
        product_type: product.product_type,
        material: product.material,
        grade: product.grade,
        dimensions: product.dimensions,
        standard: product.standard,
        unit: product.unit,
        unit_price_cents: product.unit_price_cents,
        is_active: true,
      };

      const supplyTypeId = product.family ? (supplyTypeIdByFamily.get(product.family) ?? null) : null;
      if (!existing) productsToCreate.push({ ...payload, supply_type_id: supplyTypeId });
      else if (supplyTypeId) productsToReclassify.push({ ...payload, supply_type_id: supplyTypeId });
      else productsToUpdate.push(payload);
    }

    for (const rows of [productsToUpdate, productsToReclassify]) {
      if (rows.length === 0) continue;
      const { error } = await supabase.from("products").upsert(rows, {
        onConflict: "id",
      });

      if (error) {
        throw mapDatabaseError(error, "Impossible d'actualiser les produits du fichier.");
      }
    }

    if (productsToCreate.length > 0) {
      const { error } = await supabase.from("products").insert(productsToCreate);

      if (error) {
        throw mapDatabaseError(error, "Impossible de créer les produits du fichier.");
      }
    }
  }

  const refreshedProductsResult = await readAllRows(() => supabase.from("products").select("id, reference", { count: "exact" }));
  if (refreshedProductsResult.error) {
    throw mapDatabaseError(
      refreshedProductsResult.error,
      "Les produits ont été importés, mais leurs références n'ont pas pu être rechargees."
    );
  }

  const refreshedProductLookup = buildUniqueLookup(
    (refreshedProductsResult.data ?? []) as ExistingProduct[],
    (product) => product.reference,
    normalizedReference
  );

  const priceRows = input.prices.map((price) => {
    const product = refreshedProductLookup.values.get(normalizedReference(price.product_reference));
    const supplier = supplierLookup.values.get(normalizedSupplierName(price.supplier_name));

    if (!product || !supplier) {
      throw new CatalogueApiError({
        status: 400,
        code: "TEMPLATE_REFERENCE_LOST",
        message: "Une référence produit ou fournisseur n'est plus disponible.",
      });
    }

    return {
      supplier_id: supplier.id,
      product_id: product.id,
      supplier_sku: price.supplier_sku,
      product_url: price.source_url,
      unit: price.unit,
      min_quantity: price.min_quantity,
      unit_price_cents: price.unit_price_cents,
      currency: price.currency,
      valid_from: price.valid_from,
      valid_to: maxPriceValidTo(price.valid_from),
      is_active: true,
      notes: price.comment,
    };
  });

  let createdPrices = 0;
  if (priceRows.length > 0) {
    const { data, error } = await supabase.rpc("bulk_create_supplier_prices", {
      price_rows: priceRows,
    });

    if (error?.code === "23514" && error.message.includes("supplier_catalog_item_pending_reference_check")) {
      const articleUpdate = createdProducts + updatedProducts > 0 ? "Les articles du fichier ont été enregistrés. " : "";
      throw new CatalogueApiError({
        status: 409,
        code: "SUPPLIER_REFERENCE_REVIEW_REQUIRED",
        message: articleUpdate + "La reprise des tarifs nécessite de vérifier les références sur les fiches article. Relancez ensuite l’import des tarifs.",
      });
    }
    if (error) {
      throw mapDatabaseError(error, "Impossible d'importer les tarifs fournisseurs du fichier.");
    }

    createdPrices = typeof data === "number" ? data : priceRows.length;
  }

  return {
    created_products: createdProducts,
    updated_products: updatedProducts,
    created_prices: createdPrices,
    skipped_prices: Math.max(0, priceRows.length - createdPrices),
  };
}
