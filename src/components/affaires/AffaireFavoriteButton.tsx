"use client";

import { StarIcon } from "lucide-react";

type AffaireFavoriteButtonProps = {
  isFavorite: boolean;
  isPending?: boolean;
  onToggle: () => void;
};

export function AffaireFavoriteButton({
  isFavorite,
  isPending = false,
  onToggle,
}: Readonly<AffaireFavoriteButtonProps>) {
  const label = isFavorite
    ? "Retirer des favoris"
    : "Ajouter aux favoris";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={isFavorite}
      disabled={isPending}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8 sm:min-w-8 ${
        isFavorite
          ? "text-amber-500 hover:bg-amber-50 hover:text-amber-600"
          : "text-slate-300 hover:bg-amber-50 hover:text-amber-500"
      }`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <StarIcon fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" size={16} />
    </button>
  );
}
