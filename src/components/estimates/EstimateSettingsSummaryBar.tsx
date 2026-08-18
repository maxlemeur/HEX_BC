"use client";

import { useMemo } from "react";

import { Popover } from "@/components/ui/Popover";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";

function formatSignedCurrency(
  cents: number,
  currency: SupportedEstimateCurrency,
) {
  const formatted = formatCurrency(Math.abs(cents), currency);
  if (cents > 0) return `+${formatted}`;
  if (cents < 0) return `−${formatted}`;
  return formatted;
}

/* ---------- types ---------- */

export type SettingsSection =
  | "margin"
  | "discount"
  | "tax"
  | "rounding"
  | "exclusions"
  | "general";

type EstimateSettingsSummaryBarProps = {
  totals: EstimateTotals | null;
  currency: SupportedEstimateCurrency;
  taxRateBp: number;
  isExpert: boolean;
  onOpenSettings: (section?: SettingsSection) => void;
};

/* ---------- sub-components ---------- */

type ChipVariant = "default" | "primary" | "highlight";

function SummaryChip({
  label,
  value,
  variant = "default",
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string;
  variant?: ChipVariant;
  onClick: () => void;
  ariaLabel?: string;
}) {
  const variantClass =
    variant === "primary"
      ? " estimate-summary-bar__chip--primary"
      : variant === "highlight"
        ? " estimate-summary-bar__chip--highlight"
        : "";

  return (
    <button
      type="button"
      className={`estimate-summary-bar__chip${variantClass}`}
      onClick={onClick}
      aria-label={ariaLabel ?? `${label} : ${value}`}
    >
      <span className="estimate-summary-bar__chip-label">{label}</span>
      <span className="estimate-summary-bar__chip-value">{value}</span>
    </button>
  );
}

function PopoverRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="estimate-summary-bar__popover-row"
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function GearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="estimate-summary-bar__gear"
      onClick={onClick}
      aria-label="Ouvrir les paramètres"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}

function SkeletonChips() {
  return (
    <div
      className="estimate-summary-bar__items"
      role="status"
      aria-label="Chargement des totaux"
    >
      <span className="sr-only">Chargement des totaux en cours...</span>
      <div className="estimate-summary-bar__skeleton" />
      <div className="estimate-summary-bar__skeleton" />
      <div className="estimate-summary-bar__skeleton" />
    </div>
  );
}

/* ---------- main component ---------- */

export function EstimateSettingsSummaryBar({
  totals,
  currency,
  taxRateBp,
  isExpert,
  onOpenSettings,
}: EstimateSettingsSummaryBarProps) {
  const derived = useMemo(() => {
    if (!totals) return null;

    const marginPercent = `${((totals.appliedMarginMultiplier - 1) * 100).toFixed(0)}%`;
    const tvaPrecision =
      taxRateBp % 100 === 0 ? 0 : taxRateBp % 10 === 0 ? 1 : 2;
    const tvaPercent = `${(taxRateBp / 100).toFixed(tvaPrecision)}%`;
    const discountDisplay = formatCurrency(totals.discountCents, currency);
    const totalHt = formatCurrency(totals.saleTotalCents, currency);
    const ttcBeforeRoundingCents =
      totals.roundedTtcCents - totals.roundingAdjustmentCents;
    const ttcBeforeRounding = formatCurrency(ttcBeforeRoundingCents, currency);
    const roundingAdjustment = formatSignedCurrency(
      totals.roundingAdjustmentCents,
      currency,
    );
    const totalTtc = formatCurrency(totals.roundedTtcCents, currency);

    return {
      marginPercent,
      tvaPercent,
      discountDisplay,
      totalHt,
      ttcBeforeRounding,
      roundingAdjustment,
      hasCommercialRounding: totals.roundingAdjustmentCents !== 0,
      totalTtc,
    };
  }, [totals, taxRateBp, currency]);

  const openSection = (section: SettingsSection) => () =>
    onOpenSettings(section);

  return (
    <div
      className="estimate-summary-bar"
      role="region"
      aria-label="Résumé du paramétrage"
    >
      {!derived ? (
        <SkeletonChips />
      ) : (
        <div className="estimate-summary-bar__items">
          {/* Marge — always visible */}
          <SummaryChip
            label="Marge"
            value={derived.marginPercent}
            variant="primary"
            onClick={openSection("margin")}
          />

          {isExpert ? (
            <>
              {/* TVA */}
              <SummaryChip
                label="TVA"
                value={derived.tvaPercent}
                onClick={openSection("tax")}
              />
              {/* Remise */}
              <SummaryChip
                label="Remise"
                value={derived.discountDisplay}
                onClick={openSection("discount")}
              />
              {/* Total HT */}
              <SummaryChip
                label="Total HT"
                value={derived.totalHt}
                variant="primary"
                onClick={openSection("general")}
              />
              {/* Total TTC */}
              <SummaryChip
                label="TTC à payer"
                value={derived.totalTtc}
                variant="highlight"
                onClick={openSection("rounding")}
                ariaLabel={
                  derived.hasCommercialRounding
                    ? `TTC calculé ${derived.ttcBeforeRounding}, arrondi commercial ${derived.roundingAdjustment}, TTC à payer ${derived.totalTtc}`
                    : undefined
                }
              />
              {derived.hasCommercialRounding ? (
                <SummaryChip
                  label="Arrondi"
                  value={derived.roundingAdjustment}
                  onClick={openSection("rounding")}
                  ariaLabel={`Arrondi commercial optionnel : ${derived.roundingAdjustment}`}
                />
              ) : null}
            </>
          ) : (
            <>
              {/* Total HT — always visible in simplified */}
              <SummaryChip
                label="Total HT"
                value={derived.totalHt}
                variant="primary"
                onClick={openSection("general")}
              />
              {/* Overflow popover for simplified mode */}
              <Popover
                hover
                portal
                trigger={
                  <button
                    type="button"
                    className="estimate-summary-bar__chip"
                    aria-label="Voir les détails de TVA, remise et TTC"
                  >
                    ...
                  </button>
                }
              >
                <div className="estimate-summary-bar__popover-content">
                  <PopoverRow
                    label="TVA"
                    value={derived.tvaPercent}
                    onClick={openSection("tax")}
                  />
                  <PopoverRow
                    label="Remise"
                    value={derived.discountDisplay}
                    onClick={openSection("discount")}
                  />
                  <PopoverRow
                    label="TTC calculé"
                    value={derived.ttcBeforeRounding}
                    onClick={openSection("rounding")}
                  />
                  {derived.hasCommercialRounding ? (
                    <PopoverRow
                      label="Arrondi commercial"
                      value={derived.roundingAdjustment}
                      onClick={openSection("rounding")}
                    />
                  ) : null}
                  <PopoverRow
                    label="TTC à payer"
                    value={derived.totalTtc}
                    onClick={openSection("rounding")}
                  />
                </div>
              </Popover>
            </>
          )}
        </div>
      )}

      <GearButton onClick={() => onOpenSettings()} />
    </div>
  );
}
