"use client";

export default function AffaireHubError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--slate-300)]"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
      <p className="text-sm text-[var(--slate-500)]">
        Impossible de charger cette affaire.
      </p>
      <button type="button" className="btn btn-secondary" onClick={reset}>
        Reessayer
      </button>
    </div>
  );
}
