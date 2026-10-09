import type { ProductRecord } from "@/app/dashboard/products/ProductFormModal";
import type { PriceFreshnessLevel } from "@/lib/catalogue/stale-prices";

/** One row of `/api/catalogue?view=page`: the product plus its price-coverage facts. */
export type ProductView = ProductRecord & {
  _status: "active" | "archived";
  _priceStatus: "none" | PriceFreshnessLevel;
  _supplierPriceCount: number;
  _bestSupplierPriceCents: number | null;
  _bestSupplierName: string | null;
  _bestSupplierPriceUpdatedAt: string | null;
  _referencePriceSourceOrderId: string | null;
  _referencePriceSourceOrderReference: string | null;
  _referencePriceSourceSupplierName: string | null;
  _referencePriceSourceDate: string | null;
};

export type ProductCatalogueCounters = {
  active: number;
  covered: number;
  withoutSupplierPrice: number;
  stale: number;
};
