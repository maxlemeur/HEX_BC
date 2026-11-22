import { requestJsonUncoordinated } from "@/lib/estimates/client-http";

import type { CreateProductPackagingInput, ProductPackagings, UpdateProductPackagingInput } from "./packagings";

/**
 * Browser-side calls for the sale packagings of an article. Each function is one HTTP request and answers the
 * article's packagings as the server holds them after it (marking one usual takes the mark from another).
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function packagingsPath(productId: string, packagingId?: string): string {
  const base = `/api/products/${encodeURIComponent(productId)}/packagings`;
  return packagingId ? `${base}/${encodeURIComponent(packagingId)}` : base;
}

function normalize(answer: Partial<ProductPackagings> | null | undefined): ProductPackagings {
  return { items: answer?.items ?? [], can_edit: answer?.can_edit === true };
}

export async function fetchProductPackagings(productId: string, signal?: AbortSignal): Promise<ProductPackagings> {
  return normalize(await requestJsonUncoordinated<Partial<ProductPackagings>>(
    packagingsPath(productId),
    { method: "GET", cache: "no-store", signal },
    "Les conditionnements n’ont pas pu être chargés.",
  ));
}

export async function createProductPackaging(
  productId: string,
  input: CreateProductPackagingInput,
): Promise<ProductPackagings> {
  return normalize(await requestJsonUncoordinated<Partial<ProductPackagings>>(
    packagingsPath(productId),
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(input) },
    "Le conditionnement n’a pas pu être ajouté.",
  ));
}

export async function updateProductPackaging(
  productId: string,
  packagingId: string,
  input: UpdateProductPackagingInput,
): Promise<ProductPackagings> {
  return normalize(await requestJsonUncoordinated<Partial<ProductPackagings>>(
    packagingsPath(productId, packagingId),
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(input) },
    "Le conditionnement n’a pas pu être enregistré.",
  ));
}

export async function deleteProductPackaging(productId: string, packagingId: string): Promise<ProductPackagings> {
  return normalize(await requestJsonUncoordinated<Partial<ProductPackagings>>(
    packagingsPath(productId, packagingId),
    { method: "DELETE" },
    "Le conditionnement n’a pas pu être retiré.",
  ));
}
