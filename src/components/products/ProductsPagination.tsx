"use client";

import { ListPagination, type ListPaginationProps } from "@/components/catalogue/ListPagination";

/** Pagination of the products table. */
export function ProductsPagination<Size extends number>(
  props: Omit<ListPaginationProps<Size>, "label" | "itemsLabel">
) {
  return <ListPagination label="Pagination des produits" itemsLabel="Produits" {...props} />;
}
