"use client";

import { useEffect, useState } from "react";
import { NumberInput, parseLocalizedNumberInput } from "@/components/ui/NumberInput";
import {
  SUPPORTED_ESTIMATE_CURRENCIES,
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type {
  DiscountStepTotal,
  EstimateTotals,
  MarginMode,
  RoundingMode,
} from "@/lib/estimate-calculations";
import type { MarginTier } from "@/lib/estimates/margin-tiers";

export type DiscountMode = "simple" | "cascade";

export type EstimateSettingsState = {
  title: string;
  date_devis: string;
  exclusions: string;
  validite_jours: number;
  currency: SupportedEstimateCurrency;
  margin_multiplier: number;
  margin_mode?: MarginMode;
  margin_tiers?: MarginTier[];
  discount_cents: number;
  discount_mode?: DiscountMode;
  discount_steps?: number[];
  global_coefficient?: number;
  tax_rate_bp: number;
  /** EST-E27 : role contractuel — pilote le regime de TVA du devis. */
  contractor_role?: string;
  rounding_mode: RoundingMode;
  rounding_step_cents: number;
};

type EstimateSettingsPanelProps = {
  projectName: string;
  versionNumber: number;
  settings: EstimateSettingsState;
  totals: EstimateTotals | null;
  isSaving: boolean;
  isReadOnly: boolean;
  error: string | null;
  onChange: (patch: Partial<EstimateSettingsState>) => void;
  onSave: () => void;
};

const MARGIN_SUGGESTIONS = [1.05, 1.1, 1.2, 1.3, 1.5];
const DEFAULT_TAX_BP = 2000;
const MAX_CASCADE_STEPS = 4;
const DEFAULT_CASCADE_STEP_BP = 500;
const GLOSSARY_DISMISSED_STORAGE_KEY = "est-glossary-dismissed";

function getRoundingOptions(currency: SupportedEstimateCurrency) {
  return [
    { label: "Aucun", mode: "none" as const, step: 1 },
    { label: `1 ${currency}`, mode: "nearest" as const, step: 100 },
    { label: `10 ${currency}`, mode: "nearest" as const, step: 1000 },
    { label: `50 ${currency}`, mode: "nearest" as const, step: 5000 },
    { label: `100 ${currency}`, mode: "nearest" as const, step: 10000 },
  ];
}

function getRoundingValue(
  mode: RoundingMode,
  step: number,
  options: ReturnType<typeof getRoundingOptions>
) {
  if (mode === "none") return "none";
  const match = options.find(
    (option) => option.mode === mode && option.step === step
  );
  return match ? `${match.step}` : "none";
}

function formatMarginMultiplier(multiplier: number) {
  return multiplier.toFixed(2);
}

function sortMarginTiers(tiers: MarginTier[]) {
  return [...tiers].sort((left, right) => {
    if (left.threshold_cents !== right.threshold_cents) {
      return left.threshold_cents - right.threshold_cents;
    }
    return (left.position ?? 0) - (right.position ?? 0);
  });
}

function clampCascadeStepBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 10000);
}

function normalizeCascadeStepsBp(steps: number[] | undefined): number[] {
  return (steps ?? [])
    .map((step) => clampCascadeStepBp(step))
    .slice(0, MAX_CASCADE_STEPS);
}

function toPercentFromBp(stepBp: number) {
  return stepBp / 100;
}

function toBpFromPercent(percent: number) {
  return clampCascadeStepBp(Math.round(percent * 100));
}

function parseNonNegativeNumberInput(value: string) {
  const parsedValue = parseLocalizedNumberInput(value);
  if (parsedValue === null) {
    return null;
  }

  return Math.max(parsedValue, 0);
}

function parseIntegerNumberInput(value: string) {
  const parsedValue = parseLocalizedNumberInput(value);
  if (parsedValue === null) {
    return null;
  }

  return Math.max(Math.round(parsedValue), 0);
}

function getStepTotal(step: DiscountStepTotal | undefined) {
  if (!step) return null;
  return step.subtotalAfterCents;
}

export function EstimateSettingsPanel({
  projectName,
  versionNumber,
  settings,
  totals,
  isSaving,
  isReadOnly,
  error,
  onChange,
  onSave,
}: EstimateSettingsPanelProps) {
  const [glossaryDismissed, setGlossaryDismissed] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(GLOSSARY_DISMISSED_STORAGE_KEY) === "1";
      if (!dismissed) return;
      const rafId = window.requestAnimationFrame(() => setGlossaryDismissed(true));
      return () => window.cancelAnimationFrame(rafId);
    } catch {
      return undefined;
    }
  }, []);

  const taxEnabled = settings.tax_rate_bp > 0;
  const taxRatePercent = settings.tax_rate_bp / 100;
  const roundingOptions = getRoundingOptions(settings.currency);
  const roundingValue = getRoundingValue(
    settings.rounding_mode,
    settings.rounding_step_cents,
    roundingOptions
  );
  const marginMode: MarginMode = settings.margin_mode ?? "fixed";
  const marginTiers = sortMarginTiers(settings.margin_tiers ?? []);
  const discountMode: DiscountMode =
    settings.discount_mode === "cascade" ? "cascade" : "simple";
  const discountStepsBp = normalizeCascadeStepsBp(settings.discount_steps);
  const globalCoefficient = Number.isFinite(settings.global_coefficient ?? NaN)
    ? Math.max(settings.global_coefficient ?? 1, 0)
    : 1;
  const discountStepTotals = totals?.discountStepTotals ?? [];

  return (
    <div className="dashboard-card p-8">
      {error && (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {error}
        </div>
      )}

      {!glossaryDismissed && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-info/30 bg-info-light p-3 text-xs text-info">
          <div className="flex-1">
            <p className="font-semibold">Glossaire</p>
            <ul className="mt-1 space-y-0.5">
              <li><strong>FO</strong> = Fourniture (materiaux, produits)</li>
              <li><strong>MO</strong> = Main d&apos;oeuvre (travail, pose)</li>
              <li><strong>K</strong> = Coefficient multiplicateur</li>
              <li><strong>HT</strong> = Hors taxes / <strong>TTC</strong> = Toutes taxes comprises</li>
            </ul>
          </div>
          <button
            type="button"
            className="shrink-0 text-info/50 hover:text-info"
            onClick={() => {
              setGlossaryDismissed(true);
              try { localStorage.setItem(GLOSSARY_DISMISSED_STORAGE_KEY, "1"); } catch {}
            }}
            aria-label="Masquer le glossaire"
          >
            &#x2715;
          </button>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="form-label" htmlFor="estimate-project-name">
            Projet
          </label>
          <input
            id="estimate-project-name"
            className="form-input"
            value={projectName}
            readOnly
          />
        </div>

        <div className="sm:col-span-2">
          <label className="form-label" htmlFor="estimate-title">
            Titre
          </label>
          <input
            id="estimate-title"
            className="form-input"
            value={settings.title}
            disabled={isReadOnly}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="estimate-date">
            Date devis
          </label>
          <input
            id="estimate-date"
            className="form-input"
            type="date"
            value={settings.date_devis}
            disabled={isReadOnly}
            onChange={(event) => onChange({ date_devis: event.target.value })}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="estimate-validite">
            Validite (jours)
          </label>
          <NumberInput
            id="estimate-validite"
            className="form-input"
            min={1}
            value={settings.validite_jours}
            disabled={isReadOnly}
            parseValue={parseIntegerNumberInput}
            emptyValue={0}
            onValueChange={(validite_jours) => onChange({ validite_jours })}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="estimate-version">
            Version
          </label>
          <input
            id="estimate-version"
            className="form-input"
            value={`V${versionNumber}`}
            readOnly
          />
        </div>

        <div>
          <label className="form-label" htmlFor="estimate-currency">
            Devise
          </label>
          <select
            id="estimate-currency"
            className="form-input form-select"
            value={settings.currency}
            disabled={isReadOnly}
            onChange={(event) =>
              onChange({
                currency: event.target.value as SupportedEstimateCurrency,
              })
            }
          >
            {SUPPORTED_ESTIMATE_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-8" data-testid="estimate-exclusions-section">
        <label className="form-label" htmlFor="estimate-exclusions">
          Précisions et exclusions particulières
        </label>
        <p className="mb-2 text-xs text-muted-foreground">
          Indiquez uniquement les prestations, fournitures ou limites propres à cette
          offre. Évitez d&apos;y recopier les règles commerciales déjà prévues par les
          CGV.
        </p>
        <textarea
          id="estimate-exclusions"
          className="form-input min-h-32 resize-y py-3"
          value={settings.exclusions}
          disabled={isReadOnly}
          maxLength={5000}
          placeholder="Ex. : cordiste, DOE, équilibrage, calorifuge des robinetteries..."
          onChange={(event) => onChange({ exclusions: event.target.value })}
        />
      </div>

      <div className="estimate-settings-grid mt-8 flex flex-col-reverse gap-6 lg:grid lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <p className="form-label">Mode de marge</p>
            <div className="estimate-chip-row mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={`estimate-chip ${
                  marginMode === "fixed" ? "estimate-chip--active" : ""
                }`}
                disabled={isReadOnly}
                onClick={() => onChange({ margin_mode: "fixed" })}
              >
                Marge fixe
              </button>
              <button
                type="button"
                className={`estimate-chip ${
                  marginMode === "tiered" ? "estimate-chip--active" : ""
                }`}
                disabled={isReadOnly}
                onClick={() => onChange({ margin_mode: "tiered" })}
              >
                Marge par tranche
              </button>
            </div>
          </div>

          {marginMode === "fixed" ? (
            <div>
              <label className="form-label" htmlFor="estimate-margin">
                Marge
              </label>
              <p className="mb-1 text-xs text-muted-foreground">
                Multiplicateur appliqué au coût. Ex : 1.20 = marge de 20%.
              </p>
              <p className="mb-2 text-xs text-muted-foreground">
                Ex : Coût 1 000 € × 1.20 = Vente 1 200 € (200 € de marge)
              </p>
              <div className="flex items-center gap-3">
                <NumberInput
                  id="estimate-margin"
                  className="form-input flex-1"
                  step="0.01"
                  min={0}
                  value={settings.margin_multiplier}
                  disabled={isReadOnly}
                  parseValue={parseNonNegativeNumberInput}
                  emptyValue={0}
                  onValueChange={(margin_multiplier) =>
                    onChange({ margin_multiplier })
                  }
                />
                <span className="shrink-0 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm font-medium text-slate-600">
                  {settings.margin_multiplier > 0
                    ? `${((settings.margin_multiplier - 1) * 100).toFixed(0)}%`
                    : "0%"}
                </span>
              </div>
              <div className="estimate-chip-row mt-3 flex flex-wrap gap-2">
                {MARGIN_SUGGESTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`estimate-chip ${
                      settings.margin_multiplier === value
                        ? "estimate-chip--active"
                        : ""
                    }`}
                    onClick={() => onChange({ margin_multiplier: value })}
                    disabled={isReadOnly}
                    title={`Marge de ${((value - 1) * 100).toFixed(0)}%`}
                  >
                    {formatMarginMultiplier(value)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="form-label">Tranches configurees</p>
              {marginTiers.length > 0 ? (
                <div className="space-y-2">
                  {marginTiers.map((tier) => (
                    <div
                      key={`${tier.id ?? "tier"}-${tier.position ?? tier.threshold_cents}-${tier.threshold_cents}-${tier.multiplier}`}
                      className="estimate-summary__row"
                    >
                      <span>
                        A partir de{" "}
                        {formatCurrency(tier.threshold_cents, settings.currency)}
                      </span>
                      <strong>x{formatMarginMultiplier(tier.multiplier)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucune tranche de marge configuree.
                </p>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <p className="form-label">Mode remise</p>
              <div className="estimate-chip-row mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`estimate-chip ${
                    discountMode === "simple" ? "estimate-chip--active" : ""
                  }`}
                  disabled={isReadOnly}
                  onClick={() => onChange({ discount_mode: "simple" })}
                >
                  Simple
                </button>
                <button
                  type="button"
                  className={`estimate-chip ${
                    discountMode === "cascade" ? "estimate-chip--active" : ""
                  }`}
                  disabled={isReadOnly}
                  onClick={() => {
                    onChange({
                      discount_mode: "cascade",
                      discount_steps: discountStepsBp,
                      global_coefficient: globalCoefficient,
                    });
                  }}
                >
                  Cascade
                </button>
              </div>
            </div>

            {discountMode === "simple" ? (
              <div>
                <label className="form-label" htmlFor="estimate-discount">
                  Remise ({settings.currency} HT)
                </label>
                <NumberInput
                  id="estimate-discount"
                  className="form-input"
                  step="0.01"
                  min={0}
                  value={settings.discount_cents / 100}
                  disabled={isReadOnly}
                  parseValue={parseNonNegativeNumberInput}
                  emptyValue={0}
                  onValueChange={(discountEuros) =>
                    onChange({
                      discount_mode: "simple",
                      discount_steps: [],
                      discount_cents: Math.round(discountEuros * 100),
                    })
                  }
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    className="form-label"
                    htmlFor="estimate-discount-global-coefficient"
                  >
                    Coefficient global
                  </label>
                  <NumberInput
                    id="estimate-discount-global-coefficient"
                    className="form-input"
                    min={0}
                    step="0.01"
                    value={globalCoefficient}
                    disabled={isReadOnly}
                    parseValue={parseNonNegativeNumberInput}
                    emptyValue={0}
                    onValueChange={(global_coefficient) =>
                      onChange({
                        discount_mode: "cascade",
                        global_coefficient,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  {discountStepsBp.map((stepBp, index) => (
                    <div
                      key={`discount-step-${index}`}
                      className="rounded-lg border border-border bg-surface-subtle p-3"
                    >
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[180px] flex-1">
                          <label
                            className="form-label"
                            htmlFor={`estimate-discount-step-${index}`}
                          >
                            Etape {index + 1} (%)
                          </label>
                          <NumberInput
                            id={`estimate-discount-step-${index}`}
                            className="form-input"
                            min={0}
                            max={100}
                            step="0.01"
                            value={toPercentFromBp(stepBp)}
                            disabled={isReadOnly}
                            parseValue={parseNonNegativeNumberInput}
                            emptyValue={0}
                            onValueChange={(percent) => {
                              const nextSteps = [...discountStepsBp];
                              nextSteps[index] = toBpFromPercent(percent);
                              onChange({
                                discount_mode: "cascade",
                                discount_steps: nextSteps,
                              });
                            }}
                          />
                        </div>
                        <div className="min-w-[170px] flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-slate-600">
                          Total apres etape:{" "}
                          <strong>
                            {formatCurrency(
                              getStepTotal(discountStepTotals[index]) ?? 0,
                              settings.currency
                            )}
                          </strong>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={isReadOnly}
                          onClick={() => {
                            const nextSteps = discountStepsBp.filter(
                              (_, stepIndex) => stepIndex !== index
                            );
                            onChange({
                              discount_mode: "cascade",
                              discount_steps: nextSteps,
                            });
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isReadOnly || discountStepsBp.length >= MAX_CASCADE_STEPS}
                  onClick={() => {
                    const nextSteps = [...discountStepsBp, DEFAULT_CASCADE_STEP_BP];
                    onChange({
                      discount_mode: "cascade",
                      discount_steps: nextSteps,
                    });
                  }}
                >
                  Ajouter une etape
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="form-label" htmlFor="estimate-contractor-role">
              Régime de TVA
            </label>
            <select
              id="estimate-contractor-role"
              className="form-input"
              disabled={isReadOnly}
              value={settings.contractor_role ?? "principal"}
              onChange={(event) =>
                onChange({
                  contractor_role:
                    event.target.value === "subcontractor"
                      ? "subcontractor"
                      : "principal",
                })
              }
            >
              <option value="principal">
                Entreprise principale — TVA facturée
              </option>
              <option value="subcontractor">
                Sous-traitance — TVA autoliquidée
              </option>
            </select>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              {settings.contractor_role === "subcontractor"
                ? "Le devis est émis hors taxe et porte la mention « Autoliquidation » (art. 283, 2 nonies du CGI). La TVA est due par le preneur."
                : "Régime normal : la TVA est facturée au taux applicable."}
            </p>
            {/*
              EST-E27 — D2 : le logiciel PROPOSE le régime, il ne le déduit
              jamais. Les exclusions du dispositif (nettoyage sous contrat
              séparé, fabrication de matériaux, prestations intellectuelles,
              location d'engins) dépendent de la nature du CONTRAT, que
              l'application ne connaît pas. L'arbitrage revient à l'utilisateur.
            */}
          </div>

          <div>
            <label className="form-label" htmlFor="estimate-tax">
              TVA unique
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="estimate-toggle">
                <input
                  type="checkbox"
                  checked={taxEnabled}
                  disabled={isReadOnly}
                  onChange={(event) => {
                    if (event.target.checked) {
                      onChange({
                        tax_rate_bp: settings.tax_rate_bp || DEFAULT_TAX_BP,
                      });
                      return;
                    }
                    onChange({ tax_rate_bp: 0 });
                  }}
                />
                <span>Appliquer TVA</span>
              </label>
              <div className="estimate-tax-input">
                <NumberInput
                  id="estimate-tax"
                  className="form-input"
                  step="0.01"
                  min={0}
                  value={taxRatePercent}
                  parseValue={parseNonNegativeNumberInput}
                  emptyValue={0}
                  onValueChange={(taxRatePercentValue) =>
                    onChange({
                      tax_rate_bp: Math.round(taxRatePercentValue * 100),
                    })
                  }
                  disabled={!taxEnabled || isReadOnly}
                />
                <span className="estimate-tax-suffix">%</span>
              </div>
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="estimate-rounding">
              Arrondi
            </label>
            <select
              id="estimate-rounding"
              className="form-input form-select"
              value={roundingValue}
              disabled={isReadOnly}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "none") {
                  onChange({ rounding_mode: "none", rounding_step_cents: 1 });
                  return;
                }
                const nextStep = Number(nextValue);
                onChange({
                  rounding_mode: "nearest",
                  rounding_step_cents: nextStep,
                });
              }}
            >
              {roundingOptions.map((option) => (
                <option
                  key={`${option.mode}-${option.step}`}
                  value={option.mode === "none" ? "none" : `${option.step}`}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="estimate-summary lg:sticky lg:top-8 lg:self-start">
          <div className="estimate-summary__header">
            <h3>Resume</h3>
            <p>Calculs temps reel</p>
          </div>

          {totals ? (
            <div className="estimate-summary__list">
              <div className="estimate-summary__row">
                <span>Cout total</span>
                <strong>
                  {formatCurrency(totals.costSubtotalCents, settings.currency)}
                </strong>
              </div>
              <div className="estimate-summary__row">
                <span>Vente HT</span>
                <strong>
                  {formatCurrency(totals.saleSubtotalCents, settings.currency)}
                </strong>
              </div>
              <div className="estimate-summary__row">
                <span>Marge appliquee</span>
                <strong>
                  x{formatMarginMultiplier(totals.appliedMarginMultiplier)}
                </strong>
              </div>
              <div className="estimate-summary__row">
                <span>Remise</span>
                <strong>
                  -{formatCurrency(totals.discountCents, settings.currency)}
                </strong>
              </div>
              <div className="estimate-summary__row estimate-summary__row--bold">
                <span>Total HT</span>
                <strong>
                  {formatCurrency(totals.saleTotalCents, settings.currency)}
                </strong>
              </div>
              <div className="estimate-summary__row">
                <span>TVA</span>
                <strong>
                  {formatCurrency(totals.adjustedTaxCents, settings.currency)}
                </strong>
              </div>
              <div className="estimate-summary__row">
                <span>Ajustement arrondi</span>
                <strong>
                  {formatCurrency(totals.roundingAdjustmentCents, settings.currency)}
                </strong>
              </div>
              <div className="estimate-summary__row estimate-summary__row--total">
                <span>Total TTC</span>
                <strong>
                  {formatCurrency(totals.roundedTtcCents, settings.currency)}
                </strong>
              </div>
            </div>
          ) : (
            <p className="estimate-summary__placeholder">Chargement...</p>
          )}

          <button
            className="btn btn-primary w-full mt-4"
            type="button"
            onClick={onSave}
            disabled={isSaving || isReadOnly}
          >
            {isReadOnly ? (
              "Lecture seule"
            ) : isSaving ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                Enregistrement...
              </>
            ) : (
              "Enregistrer le parametrage"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
