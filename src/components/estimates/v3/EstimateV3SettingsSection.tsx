"use client";

import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";

import { TaxRatePropagationDialog } from "@/components/estimates/v3/TaxRatePropagationDialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { controlSizes, controlSurface } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  formatEstimateV3Coefficient,
  formatEstimateV3RatePercent,
  type EstimateV3SettingsController,
  type EstimateV3SettingsTextField,
} from "@/hooks/useEstimateV3Settings";
import type { EstimateV3Breakdown } from "@/lib/estimates/engine-v3";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type EstimateV3SettingsSectionProps = {
  controller: EstimateV3SettingsController;
  /** Devise affichée tant que le brouillon est illisible. */
  fallbackCurrency: SupportedEstimateCurrency;
  isReadOnly: boolean;
  isSaving: boolean;
  /** Sauvegarde de l'éditeur ; appelée par `requestSave` quand rien ne la bloque. */
  onSave: () => unknown;
  /** Régime de TVA, commun à tous les moteurs, rendu par le panneau. */
  contractorRoleField?: ReactNode;
};

const FIELD_CLASS = "flex min-w-0 flex-col gap-2";
const GROUP_TITLE_CLASS = "text-sm font-medium text-foreground";
const INPUT_CLASS = cn(controlSurface, controlSizes.md, "w-full");
/** Paliers inférieurs proposés en v3 (D7) : aucun arrondi supérieur, au plus proche ni « Réglage conservé ». */
const ROUNDING_STEPS_CENTS = [100, 1000, 5000, 10000] as const;
const REALIZED_COEFFICIENT_FORMAT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIER_MULTIPLIER_FORMAT = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatRealizedCoefficient(value: string | null) {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? REALIZED_COEFFICIENT_FORMAT.format(parsed) : "indéterminé";
}

type TextFieldProps = {
  controller: EstimateV3SettingsController;
  field: EstimateV3SettingsTextField;
  id: string;
  label: string;
  disabled: boolean;
  currency: SupportedEstimateCurrency;
  description?: ReactNode;
  suffix?: string;
};

/** Valeur toujours en vigueur après un refus : l'ancienne valeur est conservée, jamais remplacée par 0. */
function keptValueText(controller: EstimateV3SettingsController, field: EstimateV3SettingsTextField, currency: SupportedEstimateCurrency) {
  const { draft } = controller;
  if (!draft) return null;
  switch (field) {
    case "sale_coefficient_fo":
    case "sale_coefficient_mo":
      return `Valeur conservée : ${formatEstimateV3Coefficient(draft[field])}.`;
    case "tax_rate":
      return `Taux conservé : ${formatEstimateV3RatePercent(draft.tax_rate_bp)} %.`;
    case "discount_amount":
    case "discount_rate":
      switch (draft.discount.kind) {
        case "amount":
          return `Remise conservée : ${formatCurrency(draft.discount.amount_cents, currency)}.`;
        case "rate":
          return `Remise conservée : ${formatEstimateV3RatePercent(draft.discount.rate_bp)} %.`;
        default:
          return "Aucune remise enregistrée dans le brouillon.";
      }
    default: {
      const unknownField: never = field;
      return String(unknownField);
    }
  }
}

function V3TextField({ controller, field, id, label, disabled, description, suffix, currency }: Readonly<TextFieldProps>) {
  const error = controller.errors[field];
  const describedBy = [description ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const input = (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn(INPUT_CLASS, suffix && "w-32")}
      value={controller.texts[field]}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => controller.setText(field, event.currentTarget.value)}
      onBlur={() => controller.commitText(field)}
    />
  );
  return (
    <div className={FIELD_CLASS}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {description ? (
        <FieldDescription id={`${id}-hint`} className="text-xs">
          {description}
        </FieldDescription>
      ) : null}
      {suffix ? (
        <div className="flex items-center gap-2">
          {input}
          <span aria-hidden="true" className="text-sm text-muted-foreground">{suffix}</span>
        </div>
      ) : input}
      {error ? (
        <FieldError id={`${id}-error`}>
          {error.message} {keptValueText(controller, field, currency)}
        </FieldError>
      ) : null}
    </div>
  );
}

function DiscountAppliedText({ controller, currency }: Readonly<{ controller: EstimateV3SettingsController; currency: SupportedEstimateCurrency }>) {
  const discount = controller.draft?.discount ?? { kind: "none" as const };
  const breakdown = controller.preview?.breakdown ?? null;
  const applied = breakdown ? formatCurrency(breakdown.discount.applied_cents, currency) : null;
  let text: string;
  switch (discount.kind) {
    case "none":
      text = "Aucune remise commerciale.";
      break;
    case "amount":
      text = `Remise : demandé ${formatCurrency(discount.amount_cents, currency)} / appliqué ${applied ?? "indisponible (aperçu)"}`;
      text += breakdown && breakdown.discount.applied_cents < discount.amount_cents
        ? ", plafonnée au HT brut des lignes chiffrées."
        : ".";
      break;
    case "rate":
      text = `Remise de ${formatEstimateV3RatePercent(discount.rate_bp)} % : appliqué ${applied ?? "indisponible (aperçu)"}.`;
      break;
    default: {
      const unknownDiscount: never = discount;
      text = String(unknownDiscount);
    }
  }
  return (
    <p className="text-sm text-muted-foreground" data-testid="estimate-v3-discount-applied" aria-live="polite">
      {text}
    </p>
  );
}

function SummaryRow({ label, value, className }: Readonly<{ label: string; value: string; className?: string }>) {
  return (
    <div className={cn("estimate-summary__row", className)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function V3Summary({ breakdown, currency }: Readonly<{ breakdown: EstimateV3Breakdown; currency: SupportedEstimateCurrency }>) {
  const { totals } = breakdown;
  const money = (cents: number) => formatCurrency(cents, currency);
  return (
    <div className="estimate-summary__list">
      <SummaryRow label="Déboursé" value={money(totals.cost_subtotal_cents)} />
      <SummaryRow label="HT brut" value={money(totals.gross_ht_cents)} />
      {totals.discount_applied_cents > 0 ? (
        <SummaryRow label="Remise commerciale" value={`−${money(totals.discount_applied_cents)}`} />
      ) : null}
      {totals.commercial_rounding_cents > 0 ? (
        <SummaryRow label="Arrondi commercial" value={`−${money(totals.commercial_rounding_cents)}`} />
      ) : null}
      <SummaryRow label="Total HT" value={money(totals.total_ht_cents)} className="estimate-summary__row--bold" />
      {totals.tax_breakdown.map((row) => (
        <SummaryRow key={row.rate_bp} label={`TVA ${formatEstimateV3RatePercent(row.rate_bp)} %`} value={money(row.tax_cents)} />
      ))}
      <SummaryRow label="TVA" value={money(totals.total_tax_cents)} />
      <SummaryRow label="TTC à payer" value={money(totals.total_ttc_cents)} className="estimate-summary__row--total" />
      <SummaryRow label="Coefficient de vente réalisé" value={formatRealizedCoefficient(totals.realized_sale_coefficient)} />
    </div>
  );
}

/**
 * Lot 2, sous-lot 2.6 - réglages d'une v3 rendus par `EstimateSettingsPanel` à la place des blocs marge,
 * remise, TVA et arrondi du moteur 2 (conception D5 à D8 ; contrat d'écran §9.4.4 de
 * docs/testing/estimate-engine-v3-2.6.md). Aucun montant n'est calculé ici : l'aperçu vient du moteur pur, par le hook.
 */
export function EstimateV3SettingsSection({
  controller,
  fallbackCurrency,
  isReadOnly,
  isSaving,
  onSave,
  contractorRoleField,
}: Readonly<EstimateV3SettingsSectionProps>) {
  const { draft } = controller;
  const currency = draft?.currency ?? fallbackCurrency;
  const disabled = isReadOnly || !draft;
  const breakdown = controller.preview?.breakdown ?? null;
  const roundingValue = draft?.rounding_mode === "down" ? String(draft.rounding_step_cents) : "none";
  const roundingStepProposed = draft?.rounding_mode !== "down" ||
    (ROUNDING_STEPS_CENTS as readonly number[]).includes(draft.rounding_step_cents);
  const missingRates = breakdown?.warnings.filter((warning) => warning.code === "ESTIMATE_V3_LABOR_RATE_MISSING").length ?? 0;

  return (
    <>
      <div
        className="estimate-settings-grid mt-8 flex flex-col-reverse gap-6 lg:grid lg:grid-cols-3"
        data-testid="estimate-v3-settings-section"
      >
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {controller.unavailableMessage ? (
            <Alert variant="danger">
              Réglages du moteur de calcul 3 illisibles : {controller.unavailableMessage}
            </Alert>
          ) : null}

          <div role="group" aria-labelledby="estimate-v3-sale-coefficients-label" className="space-y-3">
            <p id="estimate-v3-sale-coefficients-label" className={GROUP_TITLE_CLASS}>
              Coefficients de vente
            </p>
            <p className="text-xs text-muted-foreground">
              PU = déboursé fourniture × coefficient FO + déboursé main-d&apos;œuvre × coefficient MO. Nombre
              supérieur à 0 et au plus 10, 4 décimales au plus.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <V3TextField
                controller={controller}
                field="sale_coefficient_fo"
                id="estimate-v3-sale-coefficient-fo"
                label="Coefficient de vente FO"
                disabled={disabled}
                currency={currency}
              />
              <V3TextField
                controller={controller}
                field="sale_coefficient_mo"
                id="estimate-v3-sale-coefficient-mo"
                label="Coefficient de vente MO"
                disabled={disabled}
                currency={currency}
              />
            </div>
            {controller.marginTierHint ? (
              <p className="text-xs text-muted-foreground" data-testid="estimate-v3-margin-tier-hint">
                Repère du barème de votre entreprise : ×{TIER_MULTIPLIER_FORMAT.format(controller.marginTierHint.multiplier)} pour
                un déboursé de {formatCurrency(controller.marginTierHint.costSubtotalCents, currency)}, non appliqué au calcul.
              </p>
            ) : null}
          </div>

          <div role="group" aria-labelledby="estimate-v3-discount-label" className="space-y-3">
            <p id="estimate-v3-discount-label" className={GROUP_TITLE_CLASS}>
              Remise commerciale
            </p>
            <p className="text-xs text-muted-foreground">
              En montant ou en pourcentage : une saisie dans un champ remplace l&apos;autre. Champ vidé : plus de remise.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <V3TextField
                controller={controller}
                field="discount_amount"
                id="estimate-v3-discount-amount"
                label={`Remise (${currency} HT)`}
                disabled={disabled}
                currency={currency}
              />
              <V3TextField
                controller={controller}
                field="discount_rate"
                id="estimate-v3-discount-rate"
                label="Remise (%)"
                disabled={disabled}
                currency={currency}
              />
            </div>
            <DiscountAppliedText controller={controller} currency={currency} />
          </div>

          {contractorRoleField}

          <V3TextField
            controller={controller}
            field="tax_rate"
            id="estimate-v3-tax-rate"
            label="TVA par défaut des nouvelles lignes"
            disabled={disabled}
            currency={currency}
            suffix="%"
            description="Chaque ligne garde son propre taux (colonne « TVA % ») ; le pied additionne la TVA par taux."
          />

          <div className={FIELD_CLASS}>
            <FieldLabel htmlFor="estimate-v3-rounding">Arrondi</FieldLabel>
            <NativeSelect
              id="estimate-v3-rounding"
              value={roundingValue}
              disabled={disabled}
              aria-describedby="estimate-v3-rounding-hint"
              onChange={(event) => {
                const step = Number(event.target.value);
                controller.updateDraft(event.target.value === "none"
                  ? { rounding_mode: "none", rounding_step_cents: 1 }
                  : { rounding_mode: "down", rounding_step_cents: step });
              }}
            >
              <option value="none">Aucun</option>
              {ROUNDING_STEPS_CENTS.map((step) => (
                <option key={step} value={String(step)}>
                  {`${formatCurrency(step, currency)} — palier inférieur`}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription id="estimate-v3-rounding-hint" className="text-xs">
              Le HT net est arrondi au palier inférieur ; l’écart est une remise HT et la TVA est calculée
              après lui.
              {roundingStepProposed || !draft
                ? null
                : ` Réglage actuel : palier inférieur de ${formatCurrency(draft.rounding_step_cents, currency)}, remplacé au prochain choix.`}
            </FieldDescription>
          </div>
        </div>

        <div className="estimate-summary lg:sticky lg:top-8 lg:self-start">
          <div className="estimate-summary__header">
            <h3>Résumé</h3>
            <p>Aperçu du moteur de calcul 3, recalculé par le serveur à l’enregistrement</p>
          </div>
          {breakdown ? (
            <V3Summary breakdown={breakdown} currency={currency} />
          ) : (
            <p role="status" className="estimate-summary__placeholder">
              {controller.preview?.error ? "Aperçu indisponible : vérifiez les lignes." : "Chargement…"}
            </p>
          )}
          {missingRates > 0 ? (
            <p className="mt-2 text-xs text-warning">
              {missingRates === 1 ? "1 ligne n’a" : `${missingRates} lignes n’ont`} pas de taux horaire : leur
              main-d’œuvre n’est pas chiffrée.
            </p>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
            onClick={() => {
              controller.requestSave(onSave);
            }}
            disabled={isSaving || disabled || controller.hasErrors}
            aria-busy={isSaving || undefined}
          >
            {isReadOnly ? (
              "Lecture seule"
            ) : isSaving ? (
              <>
                <Loader2Icon aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                Enregistrement…
              </>
            ) : (
              "Enregistrer le paramétrage"
            )}
          </Button>
        </div>
      </div>
      <TaxRatePropagationDialog
        request={controller.taxPropagation}
        onAnswer={(applyToLines) => controller.confirmTaxPropagation(applyToLines, onSave)}
        onCancel={controller.cancelTaxPropagation}
      />
    </>
  );
}
