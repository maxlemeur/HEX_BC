"use client";

import { useMemo } from "react";

import { NumberInput, parseLocalizedNumberInput } from "@/components/ui/NumberInput";
import {
  PROJECT_FAMILY_OPTIONS,
  ROUNDING_OPTIONS,
  type StepErrors,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";
import { getMarginTiers, type MarginTier } from "@/lib/estimates/margin-tiers";
import { formatEUR } from "@/lib/money";

function ReadOnlyMarginTiers({ tiers }: { tiers: MarginTier[] }) {
  const sorted = useMemo(
    () =>
      [...tiers].sort(
        (a, b) => a.threshold_cents - b.threshold_cents
      ),
    [tiers]
  );

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-[var(--slate-500)]">
        Aucune tranche de marge configurée.
      </p>
    );
  }

  return (
    <div className="table-scroll mt-3">
      <table className="data-table">
        <thead>
          <tr>
            <th>Seuil</th>
            <th>Multiplicateur</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((tier, index) => (
            <tr key={tier.id ?? index}>
              <td>{formatEUR(tier.threshold_cents)}</td>
              <td>x{tier.multiplier.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PricingStepProps = {
  data: WizardData;
  errors: StepErrors;
  updateField: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
};

export function PricingStep({
  data,
  errors,
  updateField,
}: PricingStepProps) {
  const marginTiers = useMemo(() => getMarginTiers(), []);

  function handleRoundingChange(value: string) {
    if (value === "none") {
      updateField("roundingMode", "none");
      updateField("roundingStepCents", "1");
      return;
    }

    const option = ROUNDING_OPTIONS.find((entry) => String(entry.step) === value);
    if (!option) return;
    updateField("roundingMode", option.mode);
    updateField("roundingStepCents", String(option.step));
  }

  function getRoundingValue(): string {
    if (data.roundingMode === "none") return "none";
    return data.roundingStepCents;
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <label className="form-label" htmlFor="wiz-date-devis">
          Date devis *
        </label>
        <input
          id="wiz-date-devis"
          className={`form-input ${errors.dateDevis ? "border-[var(--error)]" : ""}`}
          type="date"
          value={data.dateDevis}
          onChange={(event) => updateField("dateDevis", event.target.value)}
        />
        {errors.dateDevis && (
          <p className="mt-1 text-sm text-[var(--error)]">{errors.dateDevis}</p>
        )}
      </div>

      <div>
        <label className="form-label" htmlFor="wiz-validite">
          Validité (jours) *
        </label>
        <input
          id="wiz-validite"
          className={`form-input ${errors.validiteJours ? "border-[var(--error)]" : ""}`}
          type="number"
          min={1}
          value={data.validiteJours}
          onChange={(event) => updateField("validiteJours", event.target.value)}
        />
        {errors.validiteJours && (
          <p className="mt-1 text-sm text-[var(--error)]">{errors.validiteJours}</p>
        )}
      </div>

      <div className="sm:col-span-2">
        <span className="form-label">Mode de marge *</span>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={
              data.marginMode === "fixed"
                ? "btn btn-primary btn-sm"
                : "btn btn-secondary btn-sm"
            }
            onClick={() => updateField("marginMode", "fixed")}
          >
            Marge fixe
          </button>
          <button
            type="button"
            className={
              data.marginMode === "tiered"
                ? "btn btn-primary btn-sm"
                : "btn btn-secondary btn-sm"
            }
            onClick={() => updateField("marginMode", "tiered")}
          >
            Marge par tranche
          </button>
        </div>
        <p className="mt-1.5 text-xs text-[var(--slate-500)]">
          Marge fixe : un coefficient unique appliqué à toutes les lignes. Marge par tranche : coefficients différents selon le montant.
        </p>
      </div>

      {data.marginMode === "fixed" && (
        <div>
          <label className="form-label" htmlFor="wiz-margin-bp">
            Marge (%)
          </label>
          <div className="relative">
            <NumberInput
              id="wiz-margin-bp"
              className="form-input pr-8"
              step="0.1"
              min={0}
              value={Number(data.marginBp) > 0 ? Number(data.marginBp) / 100 : 0}
              formatValue={(percent) => ((percent ?? 0) > 0 ? String(percent) : "")}
              parseValue={(value) => {
                const parsedValue = parseLocalizedNumberInput(value);
                if (parsedValue === null) {
                  return null;
                }
                return Math.max(parsedValue, 0);
              }}
              emptyValue={0}
              onValueChange={(percent) =>
                updateField("marginBp", String(Math.round(percent * 100)))
              }
              placeholder="Ex: 15"
            />
            <span className="estimate-tax-suffix">%</span>
          </div>
        </div>
      )}

      {data.marginMode === "tiered" && (
        <div className="sm:col-span-2">
          <p className="form-label">Tranches de marge (tenant)</p>
          <p className="mb-2 text-sm text-[var(--slate-500)]">
            Les tranches ci-dessous sont configurées pour votre organisation et seront appliquées automatiquement.
          </p>
          <ReadOnlyMarginTiers tiers={marginTiers} />
        </div>
      )}

      <div>
        <label className="form-label" htmlFor="wiz-tax-rate">
          TVA (%) *
        </label>
        <div className="relative">
          <NumberInput
            id="wiz-tax-rate"
            className={`form-input pr-8 ${errors.taxRateBp ? "border-[var(--error)]" : ""}`}
            step="0.1"
            min={0}
            max={100}
            value={Number(data.taxRateBp) > 0 ? Number(data.taxRateBp) / 100 : 0}
            formatValue={(percent) => ((percent ?? 0) > 0 ? String(percent) : "")}
            parseValue={(value) => {
              const parsedValue = parseLocalizedNumberInput(value);
              if (parsedValue === null) {
                return null;
              }
              return Math.max(parsedValue, 0);
            }}
            emptyValue={0}
            onValueChange={(percent) =>
              updateField("taxRateBp", String(Math.round(percent * 100)))
            }
            placeholder="Ex: 20"
          />
          <span className="estimate-tax-suffix">%</span>
        </div>
        {errors.taxRateBp && (
          <p className="mt-1 text-sm text-[var(--error)]">{errors.taxRateBp}</p>
        )}
      </div>

      <div>
        <label className="form-label" htmlFor="wiz-rounding">
          Arrondi
        </label>
        <select
          id="wiz-rounding"
          className="form-input form-select"
          value={getRoundingValue()}
          onChange={(event) => handleRoundingChange(event.target.value)}
        >
          {ROUNDING_OPTIONS.map((option) => (
            <option
              key={`${option.mode}-${option.step}`}
              value={option.mode === "none" ? "none" : String(option.step)}
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="form-label" htmlFor="wiz-project-family">
          Famille de projet
        </label>
        <select
          id="wiz-project-family"
          className="form-input form-select"
          value={data.projectFamily}
          onChange={(event) => updateField("projectFamily", event.target.value)}
        >
          {PROJECT_FAMILY_OPTIONS.map((option) => (
            <option key={option.value || "__empty"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-[var(--slate-500)]">
          Champ optionnel memorise dans les notes du projet lors de la creation.
        </p>
      </div>
    </div>
  );
}
