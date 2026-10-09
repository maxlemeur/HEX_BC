import { Badge } from "@/components/ui/badge";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type PortalStatus = "pending" | "accepted" | "rejected" | "expired";

type PortalHeaderProps = {
  projectName: string;
  projectReference: string | null;
  versionNumber: number;
  totalHtCents: number;
  totalTtcCents: number;
  vatReverseCharge?: boolean;
  currency: SupportedEstimateCurrency;
  expiresAt: string;
  status: PortalStatus;
};

function formatPortalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}

/**
 * UX73 : le statut de décision n'est affiché qu'ici, en tête de page. Le bloc
 * d'actions en bas de page ne le répète plus.
 */
const STATUS_DISPLAY: Record<
  PortalStatus,
  {
    variant: "info" | "success" | "neutral" | "warning";
    label: string;
    message?: string;
  }
> = {
  pending: { variant: "info", label: "En attente de votre réponse" },
  accepted: {
    variant: "success",
    label: "Accepté",
    message: "Vous avez accepté ce devis. Merci pour votre confiance.",
  },
  rejected: {
    variant: "neutral",
    label: "Refusé",
    message: "Vous avez refusé ce devis.",
  },
  expired: {
    variant: "warning",
    label: "Expiré",
    message: "Ce devis a expiré. Contactez votre interlocuteur pour en obtenir un nouveau.",
  },
};

export function PortalHeader({
  projectName,
  projectReference,
  versionNumber,
  totalHtCents,
  totalTtcCents,
  vatReverseCharge = false,
  currency,
  expiresAt,
  status,
}: PortalHeaderProps) {
  const expired = isExpired(expiresAt);
  const effectiveStatus = status === "pending" && expired ? "expired" : status;
  const display = STATUS_DISPLAY[effectiveStatus];

  return (
    <header className="rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="typo-h2 break-words text-foreground">{projectName}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {projectReference ? (
              <Badge variant="accent" className="rounded-control font-mono">
                {projectReference}
              </Badge>
            ) : null}
            <span className="text-sm text-muted-foreground">
              Version V{versionNumber}
            </span>
            <Badge variant={display.variant} dot>
              {display.label}
            </Badge>
          </div>
          {display.message ? (
            <p className="text-sm text-foreground-secondary">{display.message}</p>
          ) : null}
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {vatReverseCharge ? "Montant HT" : "Montant TTC"}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
            {formatCurrency(
              vatReverseCharge ? totalHtCents : totalTtcCents,
              currency
            )}
          </p>
          <p
            className={cn(
              "mt-1 text-xs",
              expired ? "font-medium text-danger" : "text-muted-foreground"
            )}
          >
            {expired ? "Expiré le" : "Valable jusqu’au"}{" "}
            {formatPortalDate(expiresAt)}
          </p>
        </div>
      </div>
    </header>
  );
}
