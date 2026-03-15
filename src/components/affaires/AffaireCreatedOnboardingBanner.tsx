import Link from "next/link";

type AffaireCreatedOnboardingBannerProps = {
  onDismiss: () => void;
  onScrollToIntake: () => void;
  onOpenImportFlow: () => void;
  manualEstimateHref: string;
};

export function AffaireCreatedOnboardingBanner({
  onDismiss,
  onScrollToIntake,
  onOpenImportFlow,
  manualEstimateHref,
}: AffaireCreatedOnboardingBannerProps) {
  return (
    <div className="mb-4 animate-fade-in rounded-xl border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold text-[var(--brand-blue)]">
          Affaire creee ! Voici comment continuer :
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-[var(--brand-blue)]/60 transition-colors hover:bg-[var(--brand-blue)]/10 hover:text-[var(--brand-blue)]"
          aria-label="Fermer"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="animate-onboarding-pulse rounded-lg border border-[var(--brand-blue)]/20 bg-white px-4 py-3">
          <p className="text-xs font-semibold text-[var(--brand-blue)]">1</p>
          <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
            Deposez votre dossier
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Les pieces du dossier lancent le cadrage automatique.
          </p>
          <button
            type="button"
            onClick={onScrollToIntake}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
          >
            Deposer
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="rounded-lg border border-[var(--slate-200)] bg-white px-4 py-3">
          <p className="text-xs font-semibold text-[var(--brand-blue)]">2</p>
          <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
            Continuer en manuel
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Le devis peut commencer sans DPGF. Posez votre base de chiffrage directement.
          </p>
          <Link
            href={manualEstimateHref}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
          >
            Ouvrir le devis
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>

        <div className="rounded-lg border border-[var(--slate-200)] bg-white px-4 py-3">
          <p className="text-xs font-semibold text-[var(--brand-blue)]">3</p>
          <p className="mt-1 text-sm font-medium text-[var(--slate-800)]">
            Ou importer un DPGF
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Le flux expert pre-remplit la structure si le bordereau est exploitable.
          </p>
          <button
            type="button"
            onClick={onOpenImportFlow}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
          >
            Importer
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
