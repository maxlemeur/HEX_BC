"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ListPaginationProps<Size extends number> = {
  /** Accessible name of the navigation, e.g. "Pagination des produits". */
  label: string;
  /** Plural noun of the listed items, e.g. "Produits". */
  itemsLabel: string;
  page: number;
  totalPages: number;
  pageSize: Size;
  pageSizes: readonly Size[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: Size) => void;
};

/** Page size switch and previous/next controls under a paginated list (products, prices). */
export function ListPagination<Size extends number>({
  label,
  itemsLabel,
  page,
  totalPages,
  pageSize,
  pageSizes,
  onPageChange,
  onPageSizeChange,
}: ListPaginationProps<Size>) {
  return (
    <nav
      aria-label={label}
      className="flex flex-col gap-4 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <div role="group" aria-label={`${itemsLabel} par page`} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true">Afficher</span>
        {pageSizes.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={pageSize === size}
            aria-label={`${size} par page`}
            className={cn(
              "min-h-9 rounded-control px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              pageSize === size
                ? "bg-foreground text-surface"
                : "bg-muted text-foreground-secondary hover:bg-surface-subtle hover:text-foreground"
            )}
            onClick={() => onPageSizeChange(size)}
          >
            {size}
          </button>
        ))}
        <span aria-hidden="true">par page</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Button
          variant="outline"
          size="md"
          className="min-h-11"
          disabled={page <= 1}
          leftIcon={<ChevronLeftIcon aria-hidden="true" />}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Précédent
        </Button>
        <span className="px-2 text-center text-xs text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="md"
          className="min-h-11"
          disabled={page >= totalPages}
          rightIcon={<ChevronRightIcon aria-hidden="true" />}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Suivant
        </Button>
      </div>
    </nav>
  );
}
