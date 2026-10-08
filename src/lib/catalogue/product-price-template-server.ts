import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

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
  category: nullableTextSchema(255),
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
    message: "Le fichier ne contient aucune ligne a importer.",
  });

export type ProductPriceTemplateImportInput = z.infer<typeof productPriceTemplateImportSchema>;

type ExistingProduct = {
  id: string;
  reference: string | null;
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

function normalizedReference(value: string) {
  return value.trim().toLocaleLowerCase("fr-FR");
}

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
  if (error.code === "42501" || message.includes("row-level security")) {
    return new CatalogueApiError({
      status: 403,
      code: "FORBIDDEN",
      message: "Vous n'avez pas les droits necessaires pour importer ce fichier.",
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

export async function importProductPriceTemplate(
  rawInput: ProductPriceTemplateImportInput
): Promise<ProductPriceTemplateImportResult> {
  const input = productPriceTemplateImportSchema.parse(rawInput);
  const supabase = await getAuthenticatedSupabase();

  const [productsResult, suppliersResult] = await Promise.all([
    supabase.from("products").select("id, reference"),
    supabase.from("suppliers").select("id, name").eq("is_active", true),
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

  for (const product of input.products) {
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
    unknownSuppliers.size > 0
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
      ]
        .filter(Boolean)
        .join(". "),
    });
  }

  let createdProducts = 0;
  let updatedProducts = 0;

  if (input.products.length > 0) {
    const productsToCreate: Array<Record<string, unknown>> = [];
    const productsToUpdate: Array<Record<string, unknown>> = [];

    for (const product of input.products) {
      const existing = productLookup.values.get(normalizedReference(product.reference));
      if (existing) updatedProducts += 1;
      else createdProducts += 1;

      const payload = {
        ...(existing ? { id: existing.id } : {}),
        reference: existing?.reference ?? product.reference,
        designation: product.designation,
        category: product.category,
        product_type: product.product_type,
        material: product.material,
        grade: product.grade,
        dimensions: product.dimensions,
        standard: product.standard,
        unit: product.unit,
        unit_price_cents: product.unit_price_cents,
        is_active: true,
      };

      if (existing) productsToUpdate.push(payload);
      else productsToCreate.push(payload);
    }

    if (productsToUpdate.length > 0) {
      const { error } = await supabase.from("products").upsert(productsToUpdate, {
        onConflict: "id",
      });

      if (error) {
        throw mapDatabaseError(error, "Impossible d'actualiser les produits du fichier.");
      }
    }

    if (productsToCreate.length > 0) {
      const { error } = await supabase.from("products").insert(productsToCreate);

      if (error) {
        throw mapDatabaseError(error, "Impossible de creer les produits du fichier.");
      }
    }
  }

  const refreshedProductsResult = await supabase.from("products").select("id, reference");
  if (refreshedProductsResult.error) {
    throw mapDatabaseError(
      refreshedProductsResult.error,
      "Les produits ont ete importes, mais leurs references n'ont pas pu etre rechargees."
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
        message: "Une reference produit ou fournisseur n'est plus disponible.",
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
      valid_to: null,
      is_active: true,
      notes: price.comment,
    };
  });

  let createdPrices = 0;
  if (priceRows.length > 0) {
    const { data, error } = await supabase.rpc("bulk_create_supplier_prices", {
      price_rows: priceRows,
    });

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
