import type { SupplierPrice } from "@/components/catalogue/types";

export type EnrichedPrice = SupplierPrice & {
  _supplierName: string;
  _productName: string;
  _freshnessLevel: "fresh" | "aging" | "stale";
  _ageDays: number;
};

export type SupplierPricesPage = {
  items: EnrichedPrice[];
  pagination: {
    page: number;
    size: 25 | 50 | 100;
    totalItems: number;
    totalPages: number;
  };
  counters: {
    total: number;
    fresh: number;
    aging: number;
    stale: number;
    uniqueSuppliers: number;
  };
};

export type SupplierPriceFormState = {
  supplier_id: string;
  product_id: string;
  unit_price_euros: string;
  currency: string;
  valid_from: string;
  valid_to: string;
  source: string;
  notes: string;
};
