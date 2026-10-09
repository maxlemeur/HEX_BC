"use client";

import Link from "next/link";
import {
  DownloadIcon,
  EllipsisIcon,
  FileSpreadsheetIcon,
  InfoIcon,
  TagsIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";

import type { ProductCatalogueCounters } from "@/components/products/product-view";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TEMPLATE_FILE_URL } from "@/lib/catalogue/product-price-template-client";

function formatCount(value: number) {
  return value.toLocaleString("fr-FR");
}

/** Secondary actions of the product base: catalogue health, imports and related pages. */
export function ProductCatalogueMenu({
  stats,
  onTemplateImport,
  onCsvImport,
}: {
  stats: ProductCatalogueCounters;
  onTemplateImport: () => void;
  onCsvImport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Ouvrir les actions du catalogue"
        className={buttonVariants({ variant: "outline", size: "icon-lg", className: "size-11" })}
      >
        <EllipsisIcon aria-hidden="true" className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80! max-w-[calc(100vw-2rem)] p-2" sideOffset={8}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5 text-micro uppercase tracking-wide">
            État du catalogue
          </DropdownMenuLabel>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-2 pb-2 text-xs text-muted-foreground">
            <div>
              <dt>Actifs</dt>
              <dd className="font-mono font-semibold text-foreground">{formatCount(stats.active)}</dd>
            </div>
            <div>
              <dt>Couverts</dt>
              <dd className="font-mono font-semibold text-success">{formatCount(stats.covered)}</dd>
            </div>
            <div>
              <dt>Sans tarif</dt>
              <dd className="font-mono font-semibold text-warning">
                {formatCount(stats.withoutSupplierPrice)}
              </dd>
            </div>
            <div>
              <dt>À revalider</dt>
              <dd className="font-mono font-semibold text-danger">{formatCount(stats.stale)}</dd>
            </div>
          </dl>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2 px-2 py-1.5">
            <InfoIcon aria-hidden="true" className="size-4" />
            Règle de prix actuelle
          </DropdownMenuLabel>
          <p className="px-2 pb-2 text-xs leading-relaxed text-muted-foreground">
            Le prix de référence est validé explicitement à partir des offres comparables ou d’une
            saisie justifiée. Les nouveaux tarifs ne remplacent pas automatiquement ce prix ni les
            coûts des devis existants.
          </p>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5 text-micro uppercase tracking-wide">
            Imports
          </DropdownMenuLabel>
          <DropdownMenuItem className="min-h-10 px-2" onClick={onTemplateImport}>
            <UploadIcon aria-hidden="true" />
            Importer produits et tarifs
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10 px-2" onClick={onCsvImport}>
            <FileSpreadsheetIcon aria-hidden="true" />
            Importer un CSV produits
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10 px-2" render={<a download href={TEMPLATE_FILE_URL} />}>
            <DownloadIcon aria-hidden="true" />
            Télécharger le modèle
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-10 px-2" render={<Link href="/dashboard/suppliers" />}>
          <UsersIcon aria-hidden="true" />
          Gérer les fournisseurs
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-10 px-2" render={<Link href="/dashboard/prices" />}>
          <TagsIcon aria-hidden="true" />
          Voir tous les tarifs
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
