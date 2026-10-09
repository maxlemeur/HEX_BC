"use client";

import { StarIcon } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

type AffaireFavoriteButtonProps = {
  isFavorite: boolean;
  isPending?: boolean;
  onToggle: () => void;
  className?: string;
};

export function AffaireFavoriteButton({
  isFavorite,
  isPending = false,
  onToggle,
  className,
}: Readonly<AffaireFavoriteButtonProps>) {
  const label = isFavorite
    ? "Retirer des favoris"
    : "Ajouter aux favoris";

  return (
    <IconButton
      label={label}
      aria-pressed={isFavorite}
      disabled={isPending}
      className={cn(isFavorite && "text-warning hover:text-warning", className)}
      icon={<StarIcon fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}
