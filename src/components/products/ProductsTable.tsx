"use client";

import Link from "next/link";
import {
  ArchiveIcon,
  DownloadIcon,
  EllipsisIcon,
  FileSpreadsheetIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  TagsIcon,
} from "lucide-react";

import type { ProductRecord } from "@/app/dashboard/products/ProductFormModal";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import type { ProductView } from "@/components/products/product-view";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TEMPLATE_FILE_URL } from "@/lib/catalogue/product-price-template-client";
import { formatEUR } from "@/lib/money";

const COLUMN_COUNT = 6;

function formatDateOnly(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value ?? "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function referencePriceSourceLabel(product: ProductView) {
  if (product.reference_price_validation_id) {
    return `Référence validée · pour ${product.reference_quantity} ${product.unit || "u"}`;
  }
  if (product.unit_price_cents === 0) return "À définir à partir des offres";
  if (!product._referencePriceSourceOrderId) return "Saisie interne";

  const source = [
    product._referencePriceSourceSupplierName,
    product._referencePriceSourceOrderReference,
    formatDateOnly(product._referencePriceSourceDate),
  ].filter(Boolean);

  return `Dernier achat confirmé${source.length > 0 ? ` · ${source.join(" · ")}` : ""}`;
}

function freshnessLabel(status: ProductView["_priceStatus"]) {
  switch (status) {
    case "fresh":
      return "À jour";
    case "aging":
      return "À surveiller";
    case "stale":
      return "À revalider";
    default:
      return "Sans prix";
  }
}

function freshnessVariant(status: ProductView["_priceStatus"]): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "fresh":
      return "success";
    case "aging":
      return "warning";
    case "stale":
      return "danger";
    default:
      return "neutral";
  }
}

type ProductsTableProps = {
  products: ProductView[];
  /** First load, nothing to show yet. */
  isInitialLoading: boolean;
  /** No product at all in the base (filters aside). */
  isCatalogueEmpty: boolean;
  /** Products matching the current filters. */
  totalItems: number;
  updatingStatusId: string | null;
  onCreate: () => void;
  onTemplateImport: () => void;
  onEdit: (product: ProductRecord) => void;
  onReviewPrice: (product: ProductRecord) => void;
  onToggleArchive: (product: ProductRecord) => void;
};

export function ProductsTable({
  products,
  isInitialLoading,
  isCatalogueEmpty,
  totalItems,
  updatingStatusId,
  onCreate,
  onTemplateImport,
  onEdit,
  onReviewPrice,
  onToggleArchive,
}: ProductsTableProps) {
  return (
    <div className="relative overflow-x-auto" role="region" aria-label="Produits" tabIndex={0}>
      <table className="data-table product-catalogue-table table-fixed md:table-auto">
        <thead>
          <tr>
            <th className="hidden w-36 lg:table-cell" scope="col">
              Référence
            </th>
            <th className="w-[38%] sm:w-auto" scope="col">
              Désignation
            </th>
            <th className="hidden min-[700px]:table-cell" scope="col">
              Caractéristiques
            </th>
            <th className="w-[26%] text-right sm:w-auto" scope="col">
              Prix
            </th>
            <th className="w-[20%] sm:w-auto" scope="col">
              État
            </th>
            <th className="w-12 text-right" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isInitialLoading ? (
            <tr>
              <td colSpan={COLUMN_COUNT} className="p-0">
                <LoadingState label="Chargement de la base produits…" />
              </td>
            </tr>
          ) : isCatalogueEmpty ? (
            <EmptyTableRow
              colSpan={COLUMN_COUNT}
              icon={<PackageIcon />}
              title="Construisez votre première base articles"
              description="Ajoutez un produit manuellement ou partez du modèle officiel pour importer produits et tarifs."
              action={
                <>
                  <Button leftIcon={<PlusIcon aria-hidden="true" />} onClick={onCreate}>
                    Ajouter un produit
                  </Button>
                  <a
                    className={buttonVariants({ variant: "outline", size: "md" })}
                    href={TEMPLATE_FILE_URL}
                    download
                  >
                    <DownloadIcon aria-hidden="true" />
                    Télécharger le modèle
                  </a>
                  <Button
                    variant="outline"
                    leftIcon={<FileSpreadsheetIcon aria-hidden="true" />}
                    onClick={onTemplateImport}
                  >
                    Importer le modèle
                  </Button>
                </>
              }
            />
          ) : totalItems === 0 ? (
            <EmptyTableRow
              colSpan={COLUMN_COUNT}
              variant="compact"
              icon={<SearchIcon />}
              title="Aucun produit ne correspond aux filtres"
              description="Modifiez la recherche ou les filtres pour voir plus de résultats."
            />
          ) : (
            products.map((product) => {
              const hasReferencePrice =
                product.unit_price_cents !== 0 || Boolean(product.reference_price_validation_id);
              const isUpdating = updatingStatusId === product.id;

              return (
                <tr key={product.id} className={product.is_active ? undefined : "opacity-60"}>
                  <td className="hidden lg:table-cell">
                    <span className="break-all font-mono text-xs text-foreground-secondary">
                      {product.reference || "Sans référence"}
                    </span>
                  </td>
                  <td>
                    <div className="break-words text-sm font-semibold leading-snug text-foreground">
                      {product.designation}
                    </div>
                    <div className="mt-1 break-all font-mono text-micro text-muted-foreground lg:hidden">
                      {product.reference || "Sans référence"}
                    </div>
                    {!product.is_active ? (
                      <Badge size="sm" className="mt-1">
                        Archivé
                      </Badge>
                    ) : null}
                  </td>
                  <td className="hidden min-[700px]:table-cell">
                    <div className="font-medium text-foreground">
                      {[product.material, product.grade].filter(Boolean).join(" ") || "Non renseigné"}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[product.category, product.product_type, product.dimensions, product.standard]
                        .filter(Boolean)
                        .join(" · ") || "Sans caractéristique"}
                    </div>
                  </td>
                  <td className="text-right">
                    <div className="whitespace-nowrap font-mono text-xs font-semibold text-foreground sm:text-sm">
                      {hasReferencePrice ? formatEUR(product.unit_price_cents) : "Prix manquant"}
                      {hasReferencePrice ? (
                        <span className="ml-1 text-micro font-normal text-muted-foreground sm:text-xs">
                          /{product.unit || "u"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 hidden text-xs text-muted-foreground md:block">
                      {referencePriceSourceLabel(product)}
                    </div>
                    <Button
                      variant="link"
                      size="xs"
                      className="mt-1 h-auto text-xs underline"
                      aria-label={`Examiner le prix de ${product.designation}`}
                      onClick={() => onReviewPrice(product)}
                    >
                      Examiner le prix
                    </Button>
                    {product._bestSupplierPriceCents !== null ? (
                      <div className="mt-1 text-micro text-success sm:text-xs">
                        Fournisseur {formatEUR(product._bestSupplierPriceCents)}
                        <span className="hidden lg:inline">
                          {` · ${product._bestSupplierName || "Non renseigné"}`}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1 text-micro text-muted-foreground sm:text-xs">Aucun tarif</div>
                    )}
                  </td>
                  <td>
                    <Badge
                      variant={freshnessVariant(product._priceStatus)}
                      className="h-auto max-w-full whitespace-normal rounded-lg py-1 text-micro leading-tight sm:rounded-full sm:whitespace-nowrap sm:text-xs"
                    >
                      {freshnessLabel(product._priceStatus)}
                    </Badge>
                  </td>
                  <td className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Actions pour ${product.designation}`}
                        className={buttonVariants({ variant: "ghost", size: "icon", className: "size-11" })}
                      >
                        <EllipsisIcon aria-hidden="true" className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48! p-1.5" sideOffset={4}>
                        <DropdownMenuItem className="min-h-10 px-2" onClick={() => onEdit(product)}>
                          <PencilIcon aria-hidden="true" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="min-h-10 px-2"
                          render={
                            <Link
                              href={`/dashboard/prices?product_id=${encodeURIComponent(product.id)}`}
                            />
                          }
                        >
                          <TagsIcon aria-hidden="true" />
                          Voir les tarifs
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="min-h-10 px-2"
                          disabled={isUpdating}
                          onClick={() => onToggleArchive(product)}
                        >
                          {product.is_active ? (
                            <ArchiveIcon aria-hidden="true" />
                          ) : (
                            <RotateCcwIcon aria-hidden="true" />
                          )}
                          {isUpdating ? "Mise à jour…" : product.is_active ? "Archiver" : "Restaurer"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
