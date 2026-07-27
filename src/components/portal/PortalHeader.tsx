import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";

type PortalHeaderProps = {
  projectName: string;
  projectReference: string | null;
  versionNumber: number;
  totalHtCents: number;
  totalTtcCents: number;
  vatReverseCharge?: boolean;
  currency: SupportedEstimateCurrency;
  expiresAt: string;
  status: "pending" | "accepted" | "rejected" | "expired";
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

const STATUS_DISPLAY: Record<
  PortalHeaderProps["status"],
  { bg: string; color: string; label: string }
> = {
  pending: { bg: "var(--info-light)", color: "var(--info)", label: "En attente" },
  accepted: { bg: "#d1fae5", color: "#059669", label: "Accepté" },
  rejected: { bg: "var(--slate-100)", color: "var(--slate-600)", label: "Refusé" },
  expired: { bg: "var(--warning-light)", color: "var(--warning)", label: "Expiré" },
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
  const badge = STATUS_DISPLAY[effectiveStatus];

  return (
    <div className="rounded-xl border border-[var(--slate-200)] bg-white p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[var(--slate-800)]">
            {projectName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {projectReference && (
              <span className="rounded-lg bg-[var(--brand-orange)]/10 px-2.5 py-1 font-mono text-sm font-bold text-[var(--brand-orange)]">
                {projectReference}
              </span>
            )}
            <span className="text-sm text-[var(--slate-500)]">
              Version V{versionNumber}
            </span>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ background: badge.bg, color: badge.color }}
            >
              {badge.label}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
            {vatReverseCharge ? "Montant HT" : "Montant TTC"}
          </p>
          <p className="mt-1 text-2xl font-bold text-[var(--brand-blue)]">
            {formatCurrency(
              vatReverseCharge ? totalHtCents : totalTtcCents,
              currency
            )}
          </p>
          <p
            className={`mt-1 text-xs ${
              expired
                ? "font-medium text-[var(--danger)]"
                : "text-[var(--slate-500)]"
            }`}
          >
            {expired ? "Expiré le" : "Valide jusqu'au"}{" "}
            {formatPortalDate(expiresAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
