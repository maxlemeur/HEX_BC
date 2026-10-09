"use client";

import { MarginTiersExplanation } from "@/components/estimates/MarginTiersExplanation";
import { NumberInput, parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import {
  PROJECT_FAMILY_OPTIONS,
  ROUNDING_OPTIONS,
  type StepErrors,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

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
          className={`form-input ${errors.dateDevis ? "border-danger" : ""}`}
          type="date"
          value={data.dateDevis}
          onChange={(event) => updateField("dateDevis", event.target.value)}
        />
        {errors.dateDevis && (
          <p className="mt-1 text-sm text-danger">{errors.dateDevis}</p>
        )}
      </div>

      <div>
        <label className="form-label" htmlFor="wiz-validite">
          Validité (jours) *
        </label>
        <input
          id="wiz-validite"
          className={`form-input ${errors.validiteJours ? "border-danger" : ""}`}
          type="number"
          min={1}
          value={data.validiteJours}
          onChange={(event) => updateField("validiteJours", event.target.value)}
        />
        {errors.validiteJours && (
          <p className="mt-1 text-sm text-danger">{errors.validiteJours}</p>
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
        <p className="mt-1.5 text-xs text-muted-foreground">
          Marge fixe : un coefficient unique choisi pour le devis. Marge par tranche : un coefficient choisi automatiquement selon le coût total HT.
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
          <p className="form-label">Tranches de marge de l’organisation</p>
          <p className="mb-2 text-sm text-muted-foreground">
            Le barème de votre organisation sera appliqué à la création. Un
            administrateur peut le consulter et le modifier dans le paramétrage
            du devis, section « Tranches de marge ».
          </p>
          <MarginTiersExplanation />
        </div>
      )}

      <div>
        <label className="form-label" htmlFor="wiz-tax-rate">
          TVA (%) *
        </label>
        <div className="relative">
          <NumberInput
            id="wiz-tax-rate"
            className={`form-input pr-8 ${errors.taxRateBp ? "border-danger" : ""}`}
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
          <p className="mt-1 text-sm text-danger">{errors.taxRateBp}</p>
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
        <p className="mt-2 text-xs text-muted-foreground">
          Champ optionnel memorise dans les notes du projet lors de la creation.
        </p>
      </div>
    </div>
  );
}
