"use client";

import { MarginTiersExplanation } from "@/components/estimates/MarginTiersExplanation";
import { getCommercialRoundingOptions } from "@/components/estimates/rounding-options";
import { NumberInput, parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import {
  PROJECT_FAMILY_OPTIONS,
  type StepErrors,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input, controlSizes, controlSurface } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

type PricingStepProps = {
  data: WizardData;
  errors: StepErrors;
  updateField: <K extends keyof WizardData>(key: K, value: WizardData[K]) => void;
};

const NUMBER_INPUT_CLASS = cn(controlSurface, controlSizes.md, "w-full pr-9");
const PERCENT_SUFFIX_CLASS =
  "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground";

function parseNonNegativePercent(value: string) {
  const parsedValue = parseLocalizedNumberInput(value);
  if (parsedValue === null) {
    return null;
  }
  return Math.max(parsedValue, 0);
}

export function PricingStep({
  data,
  errors,
  updateField,
}: PricingStepProps) {
  const rounding = getCommercialRoundingOptions("EUR", data.roundingMode, Number(data.roundingStepCents));
  function handleRoundingChange(value: string) {
    const option = rounding.options.find((entry) => entry.value === value);
    if (!option || option.preserved) return;
    updateField("roundingMode", option.mode);
    updateField("roundingStepCents", String(option.step));
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="wiz-date-devis">
          Date devis <span aria-hidden="true">*</span>
        </FieldLabel>
        <Input
          id="wiz-date-devis"
          type="date"
          value={data.dateDevis}
          aria-required="true"
          aria-invalid={errors.dateDevis ? true : undefined}
          aria-describedby={errors.dateDevis ? "wiz-date-devis-error" : undefined}
          onChange={(event) => updateField("dateDevis", event.target.value)}
        />
        {errors.dateDevis && (
          <FieldError id="wiz-date-devis-error" className="text-danger">
            {errors.dateDevis}
          </FieldError>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="wiz-validite">
          Validité (jours) <span aria-hidden="true">*</span>
        </FieldLabel>
        <Input
          id="wiz-validite"
          type="number"
          min={1}
          value={data.validiteJours}
          aria-required="true"
          aria-invalid={errors.validiteJours ? true : undefined}
          aria-describedby={errors.validiteJours ? "wiz-validite-error" : undefined}
          onChange={(event) => updateField("validiteJours", event.target.value)}
        />
        {errors.validiteJours && (
          <FieldError id="wiz-validite-error" className="text-danger">
            {errors.validiteJours}
          </FieldError>
        )}
      </div>

      <div
        role="group"
        aria-labelledby="wiz-margin-mode-label"
        aria-describedby="wiz-margin-mode-hint"
        className="flex min-w-0 flex-col gap-2 sm:col-span-2"
      >
        <span id="wiz-margin-mode-label" className="text-sm font-medium text-foreground">
          Mode de marge <span aria-hidden="true">*</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={data.marginMode === "fixed" ? "primary" : "outline"}
            size="md"
            aria-pressed={data.marginMode === "fixed"}
            onClick={() => updateField("marginMode", "fixed")}
          >
            Marge fixe
          </Button>
          <Button
            variant={data.marginMode === "tiered" ? "primary" : "outline"}
            size="md"
            aria-pressed={data.marginMode === "tiered"}
            onClick={() => updateField("marginMode", "tiered")}
          >
            Marge par tranche
          </Button>
        </div>
        <FieldDescription id="wiz-margin-mode-hint" className="text-xs">
          Marge fixe : un coefficient unique choisi pour le devis. Marge par tranche : un coefficient choisi automatiquement selon le coût total HT.
        </FieldDescription>
      </div>

      {data.marginMode === "fixed" && (
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor="wiz-margin-bp">Marge (%)</FieldLabel>
          <div className="relative">
            <NumberInput
              id="wiz-margin-bp"
              className={NUMBER_INPUT_CLASS}
              step="0.1"
              min={0}
              value={Number(data.marginBp) > 0 ? Number(data.marginBp) / 100 : 0}
              formatValue={(percent) => ((percent ?? 0) > 0 ? String(percent) : "")}
              parseValue={parseNonNegativePercent}
              emptyValue={0}
              onValueChange={(percent) =>
                updateField("marginBp", String(Math.round(percent * 100)))
              }
              placeholder="Ex. : 15"
            />
            <span aria-hidden="true" className={PERCENT_SUFFIX_CLASS}>%</span>
          </div>
        </div>
      )}

      {data.marginMode === "tiered" && (
        <div className="min-w-0 sm:col-span-2">
          <p className="text-sm font-medium text-foreground">Tranches de marge de l’organisation</p>
          <p className="mt-2 mb-2 text-sm text-muted-foreground">
            Le barème de votre organisation sera appliqué à la création. Un
            administrateur peut le consulter et le modifier dans le paramétrage
            du devis, section « Tranches de marge ».
          </p>
          <MarginTiersExplanation />
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="wiz-tax-rate">
          TVA (%) <span aria-hidden="true">*</span>
        </FieldLabel>
        <div className="relative">
          <NumberInput
            id="wiz-tax-rate"
            className={NUMBER_INPUT_CLASS}
            step="0.1"
            min={0}
            max={100}
            value={Number(data.taxRateBp) > 0 ? Number(data.taxRateBp) / 100 : 0}
            formatValue={(percent) => ((percent ?? 0) > 0 ? String(percent) : "")}
            parseValue={parseNonNegativePercent}
            emptyValue={0}
            onValueChange={(percent) =>
              updateField("taxRateBp", String(Math.round(percent * 100)))
            }
            aria-required="true"
            aria-invalid={errors.taxRateBp ? true : undefined}
            aria-describedby={errors.taxRateBp ? "wiz-tax-rate-error" : undefined}
            placeholder="Ex. : 20"
          />
          <span aria-hidden="true" className={PERCENT_SUFFIX_CLASS}>%</span>
        </div>
        {errors.taxRateBp && (
          <FieldError id="wiz-tax-rate-error" className="text-danger">
            {errors.taxRateBp}
          </FieldError>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor="wiz-rounding">Arrondi</FieldLabel>
        <NativeSelect
          id="wiz-rounding"
          value={rounding.value}
          aria-describedby="wiz-rounding-hint"
          onChange={(event) => handleRoundingChange(event.target.value)}
        >
          {rounding.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.preserved}
            >
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="wiz-rounding-hint" className="text-xs">
          Le TTC est arrondi au palier inférieur, sans descendre sous le HT.
          Un montant déjà exact reste inchangé.
        </FieldDescription>
      </div>

      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <FieldLabel htmlFor="wiz-project-family">Famille de projet</FieldLabel>
        <NativeSelect
          id="wiz-project-family"
          value={data.projectFamily}
          aria-describedby="wiz-project-family-hint"
          onChange={(event) => updateField("projectFamily", event.target.value)}
        >
          {PROJECT_FAMILY_OPTIONS.map((option) => (
            <option key={option.value || "__empty"} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
        <FieldDescription id="wiz-project-family-hint" className="text-xs">
          Champ optionnel, mémorisé dans les notes du projet lors de la création.
        </FieldDescription>
      </div>
    </div>
  );
}
