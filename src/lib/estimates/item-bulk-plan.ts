import { assertEstimateItemAidFormat } from "@/lib/estimates/item-update-plan";
import { normalizeEstimateItemAid, type BulkUpdateEstimateItemsInput } from "@/lib/estimates/schemas";

export function parseBulkUpdateCountDetails(details: string | null | undefined) {
  const match = details?.match(
    /expected_count=(\d+),(updated_count|locked_count)=(\d+)/
  );
  if (!match) return null;

  const expectedCount = Number.parseInt(match[1], 10);
  const countValue = Number.parseInt(match[3], 10);

  if (!Number.isFinite(expectedCount) || !Number.isFinite(countValue)) {
    return null;
  }

  return {
    expected_count: expectedCount,
    updated_count: countValue,
  };
}

/** Normalize supplied fields without mutating the caller or clearing absent links. */
export function prepareEstimateBulkItems(input: BulkUpdateEstimateItemsInput, aidRegex: RegExp) {
  const updatesPayload = input.map((item) => ({ ...item }));

  updatesPayload.forEach((item) => {
    if (!Object.prototype.hasOwnProperty.call(item, "aid")) {
      return;
    }

    const nextAid = normalizeEstimateItemAid(
      (item as { aid?: string | null }).aid ?? null
    );
    assertEstimateItemAidFormat({
      aid: nextAid,
      aidRegex,
    });
    (item as { aid?: string | null }).aid = nextAid;
  });

  const supplierPriceIdsToValidate = new Set<string | null>();
  const productIdsToValidate = new Set<string | null>();
  updatesPayload.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(item, "product_id")) {
      productIdsToValidate.add(item.product_id ?? null);
    }

    if (!Object.prototype.hasOwnProperty.call(item, "selected_supplier_price_id")) {
      return;
    }

    supplierPriceIdsToValidate.add(item.selected_supplier_price_id ?? null);
  });

  return { updatesPayload, productIdsToValidate, supplierPriceIdsToValidate };
}
