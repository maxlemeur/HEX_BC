import Link from "next/link";
import { ArrowRightIcon, XIcon } from "lucide-react";

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
    <div className="mb-4 animate-fade-in rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-semibold text-primary">
          Affaire créée ! Voici comment continuer :
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary"
          aria-label="Fermer"
        >
          <XIcon aria-hidden="true" size={16} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="animate-onboarding-pulse rounded-lg border border-primary/20 bg-surface px-4 py-3">
          <p className="text-xs font-semibold text-primary">1</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            Déposez votre dossier
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Les pièces du dossier lancent le cadrage automatique.
          </p>
          <button
            type="button"
            onClick={onScrollToIntake}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
          >
            Déposer
            <ArrowRightIcon aria-hidden="true" size={14} />
          </button>
        </div>

        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs font-semibold text-primary">2</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            Continuer en manuel
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Le devis peut commencer sans DPGF. Posez votre base de chiffrage directement.
          </p>
          <Link
            href={manualEstimateHref}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
          >
            Ouvrir le devis
            <ArrowRightIcon aria-hidden="true" size={14} />
          </Link>
        </div>

        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="text-xs font-semibold text-primary">3</p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            Importer la DPGF
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pre-remplissez la structure du devis si le bordereau principal est exploitable.
          </p>
          <button
            type="button"
            onClick={onOpenImportFlow}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
          >
            Importer la DPGF
            <ArrowRightIcon aria-hidden="true" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
