"use client";

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
          : "text-[var(--slate-300)] hover:bg-amber-50 hover:text-amber-500"
      }`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={isFavorite ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m12 17.27-5.18 3.05 1.4-5.89L3 9.76l6.03-.52L12 3.75l2.97 5.49 6.03.52-5.22 4.67 1.4 5.89z" />
      </svg>
    </button>
  );
}
