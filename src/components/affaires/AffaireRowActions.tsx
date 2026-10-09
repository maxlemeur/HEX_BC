"use client";

import Link from "next/link";
import { EllipsisIcon, EyeIcon, HouseIcon, SquarePenIcon, TrashIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { AffaireFavoriteButton } from "./AffaireFavoriteButton";
import type { AffaireListItem } from "./types";

export function getAffaireListItemState(item: AffaireListItem) {
  const hasCurrentVersion =
    item.hasCurrentVersion &&
    item.currentVersionId !== null &&
    item.currentVersionNumber !== null &&
    item.currentStatus !== null;

  return {
    hasCurrentVersion,
    /** Only affaires without any sent version can be selected for bulk actions or deleted. */
    isDraftOnly: !hasCurrentVersion || item.currentStatus === "draft",
  };
}

type AffaireRowActionsProps = {
  item: AffaireListItem;
  isFavoritePending: boolean;
  onToggleFavorite: () => void;
  onRequestDelete: () => void;
  /** Larger touch targets for the card list on phones. */
  touch?: boolean;
};

/**
 * Favorite + the main estimate action stay visible; the rest (hub, delete) sits in a
 * keyboard-accessible menu, so a row never shows more than three icon controls.
 */
export function AffaireRowActions({
  item,
  isFavoritePending,
  onToggleFavorite,
  onRequestDelete,
  touch = false,
}: Readonly<AffaireRowActionsProps>) {
  const { hasCurrentVersion, isDraftOnly } = getAffaireListItemState(item);
  const sizeClass = touch ? "max-sm:size-11" : undefined;
  const primaryAction = hasCurrentVersion
    ? item.currentStatus === "draft"
      ? {
          href: `/dashboard/estimates/${item.currentVersionId}/edit`,
          tooltip: "Éditer le chiffrage",
          label: `Éditer le chiffrage de l’affaire ${item.projectName}`,
          icon: <SquarePenIcon aria-hidden="true" />,
        }
      : {
          href: `/dashboard/estimates/${item.currentVersionId}`,
          tooltip: "Voir le chiffrage",
          label: `Voir le chiffrage de l’affaire ${item.projectName}`,
          icon: <EyeIcon aria-hidden="true" />,
        }
    : null;

  return (
    <div className="inline-flex items-center gap-1">
      <AffaireFavoriteButton
        isFavorite={item.isFavorite}
        isPending={isFavoritePending}
        onToggle={onToggleFavorite}
        className={sizeClass}
      />
      {primaryAction ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={primaryAction.href}
                prefetch={false}
                aria-label={primaryAction.label}
                className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), sizeClass)}
                onClick={(event) => event.stopPropagation()}
              />
            }
          >
            {primaryAction.icon}
          </TooltipTrigger>
          <TooltipContent>{primaryAction.tooltip}</TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className={sizeClass} />}
          aria-label={`Plus d’actions pour l’affaire ${item.projectName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-52">
          <DropdownMenuItem
            className="min-h-10 px-2"
            render={<Link href={`/dashboard/affaires/${item.projectId}`} prefetch={false} />}
          >
            <HouseIcon aria-hidden="true" />
            Ouvrir l’affaire
          </DropdownMenuItem>
          {isDraftOnly ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="min-h-10 px-2"
                onClick={onRequestDelete}
              >
                <TrashIcon aria-hidden="true" />
                Supprimer l’affaire
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
