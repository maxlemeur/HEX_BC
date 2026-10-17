"use client";

import { useMemo, useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import { formatEstimateV3TaxRate, type EstimateV3SummaryView } from "@/lib/estimates/v3-editor";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import { MoreHorizontalIcon, SettingsIcon } from "lucide-react";

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
  /**
   * Lot 2, sous-lot 2.6 : pied d'une v3 (aperçu du moteur pur, D7, D8), présent seulement sur une
   * v3 ; nul tant que l'aperçu est indisponible. Aucune marge v2 (multiplicateur ×1) n'y figure.
   */
  v3Summary?: EstimateV3SummaryView | null;
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
    <IconButton
      type="button"
      variant="outline"
      size="icon-sm"
      className="shrink-0"
      label="Ouvrir les paramètres"
      icon={<SettingsIcon aria-hidden="true" />}
      onClick={onClick}
    />
  );
}

function SkeletonChips() {
  return (
    <div
      className="estimate-summary-bar__items"
      role="status"
      aria-label="Chargement des totaux"
    >
      <span className="sr-only">Chargement des totaux en cours…</span>
      <div className="estimate-summary-bar__skeleton" />
      <div className="estimate-summary-bar__skeleton" />
      <div className="estimate-summary-bar__skeleton" />
    </div>
  );
}

/**
 * Pied v3 : HT net, une TVA par taux présent (somme par taux, jamais ligne à ligne), TVA totale,
 * TTC à payer = HT + TVA, et la remise ou l'arrondi commercial dès qu'ils s'appliquent (contrat
 * d'écran §9.4.3 de docs/testing/estimate-engine-v3-2.6.md).
 */
function V3SummaryItems({
  summary,
  currency,
  isExpert,
  openSection,
}: {
  summary: EstimateV3SummaryView;
  currency: SupportedEstimateCurrency;
  isExpert: boolean;
  openSection: (section: SettingsSection) => () => void;
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const money = (cents: number) => formatCurrency(cents, currency);
  const entries: Array<{ key: string; label: string; value: string; section: SettingsSection; variant?: ChipVariant }> = [
    ...(summary.discountAppliedCents > 0
      ? [{ key: "discount", label: "Remise commerciale", value: formatSignedCurrency(-summary.discountAppliedCents, currency), section: "discount" as const }]
      : []),
    ...(summary.commercialRoundingCents > 0
      ? [{ key: "rounding", label: "Arrondi commercial", value: formatSignedCurrency(-summary.commercialRoundingCents, currency), section: "rounding" as const }]
      : []),
    ...summary.taxByRate.map((row) => ({
      key: `tax-${row.rateBp}`, label: `TVA ${formatEstimateV3TaxRate(row.rateBp)} %`, value: money(row.taxCents), section: "tax" as const,
    })),
    { key: "tax", label: "TVA", value: money(summary.totalTaxCents), section: "tax" },
    { key: "ttc", label: "TTC à payer", value: money(summary.payableTtcCents), section: "rounding", variant: "highlight" },
  ];
  const totalHt = { label: "Total HT", value: money(summary.totalHtCents) };
  if (isExpert) {
    return (
      <div className="estimate-summary-bar__items">
        <SummaryChip label={totalHt.label} value={totalHt.value} variant="primary" onClick={openSection("general")} />
        {entries.map((entry) => (
          <SummaryChip key={entry.key} label={entry.label} value={entry.value} variant={entry.variant} onClick={openSection(entry.section)} />
        ))}
      </div>
    );
  }
  return (
    <div className="estimate-summary-bar__items">
      <SummaryChip label={totalHt.label} value={totalHt.value} variant="primary" onClick={openSection("general")} />
      <Popover open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <PopoverTrigger
          openOnHover
          delay={200}
          className="estimate-summary-bar__chip"
          aria-label="Voir les détails de TVA, remise et TTC"
        >
          <MoreHorizontalIcon aria-hidden="true" size={14} />
        </PopoverTrigger>
        <PopoverContent side="bottom" className="estimate-summary-bar__popover-content w-auto gap-0.5 p-1.5">
          {entries.map((entry) => (
            <PopoverRow key={entry.key} label={entry.label} value={entry.value} onClick={() => {
              setIsDetailsOpen(false);
              openSection(entry.section)();
            }} />
          ))}
        </PopoverContent>
      </Popover>
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
  v3Summary,
}: EstimateSettingsSummaryBarProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
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

  const openSection = (section: SettingsSection) => () => {
    setIsDetailsOpen(false);
    onOpenSettings(section);
  };

  return (
    <div
      className="estimate-summary-bar"
      role="region"
      aria-label="Résumé du paramétrage"
    >
      {v3Summary !== undefined ? (
        v3Summary ? (
          <V3SummaryItems summary={v3Summary} currency={currency} isExpert={isExpert} openSection={openSection} />
        ) : (
          <div className="estimate-summary-bar__items" role="status">
            Aperçu du moteur de calcul 3 indisponible : vérifiez les saisies et le paramétrage.
          </div>
        )
      ) : !derived ? (
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
              <Popover open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
                <PopoverTrigger
                  openOnHover
                  delay={200}
                  className="estimate-summary-bar__chip"
                  aria-label="Voir les détails de TVA, remise et TTC"
                >
                  <MoreHorizontalIcon aria-hidden="true" size={14} />
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  className="estimate-summary-bar__popover-content w-auto gap-0.5 p-1.5"
                >
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
                </PopoverContent>
              </Popover>
            </>
          )}
        </div>
      )}

      <GearButton onClick={() => onOpenSettings()} />
    </div>
  );
}
