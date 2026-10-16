"use client";

import { useEffect, useState } from "react";
import { NumberInput, parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import { MarginTiersExplanation } from "@/components/estimates/MarginTiersExplanation";
import { getCommercialRoundingOptions } from "@/components/estimates/rounding-options";
import {
  SUPPORTED_ESTIMATE_CURRENCIES,
  formatCurrency,
  parseCurrencyToCents,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type {
  EstimateTotals,
  MarginMode,
  RoundingMode,
} from "@/lib/estimate-calculations";
import { parseRatePercentDraft } from "@/lib/estimates/editor-values";
import { getMarginTiers, type MarginTier } from "@/lib/estimates/margin-tiers";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, controlSizes, controlSurface } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2Icon, XIcon } from "lucide-react";

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
  discount_amount_cents?: number | null;
  discount_bp?: number;
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
  isFrozen?: boolean;
  storedMarginMultiplier?: number;
  error: string | null;
  onChange: (patch: Partial<EstimateSettingsState>) => void;
  onSave: () => void;
};

const MARGIN_SUGGESTIONS = [1.05, 1.1, 1.2, 1.3, 1.5];
const DEFAULT_TAX_BP = 2000;
const GLOSSARY_DISMISSED_STORAGE_KEY = "est-glossary-dismissed";
const NUMBER_INPUT_CLASS = cn(controlSurface, controlSizes.md, "w-full");
const FIELD_CLASS = "flex min-w-0 flex-col gap-2";
const GROUP_TITLE_CLASS = "text-sm font-medium text-foreground";
const CHIP_FOCUS_CLASS =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";

function chipClassName(active: boolean) {
  return cn("estimate-chip", active && "estimate-chip--active", CHIP_FOCUS_CLASS);
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

  return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

export function EstimateSettingsPanel({
  projectName,
  versionNumber,
  settings,
  totals,
  isSaving,
  isReadOnly,
  isFrozen = false,
  storedMarginMultiplier,
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
  const { options: roundingOptions, value: roundingValue } = getCommercialRoundingOptions(
    settings.currency,
    settings.rounding_mode,
    settings.rounding_step_cents
  );
  const marginMode: MarginMode = settings.margin_mode ?? "fixed";
  const marginTiers = sortMarginTiers(
    settings.margin_tiers?.length ? settings.margin_tiers : getMarginTiers()
  );
  const discountMode: DiscountMode =
    settings.discount_mode === "cascade" ? "cascade" : "simple";
  const globalCoefficient = Number.isFinite(settings.global_coefficient ?? NaN)
    ? Math.max(settings.global_coefficient ?? 1, 0)
    : 1;

  return (
    <Card className="p-5 sm:p-8">
      {error && (
        <Alert variant="danger" className="mb-6">
          {error}
        </Alert>
      )}

      {!glossaryDismissed && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-info-border bg-info-subtle p-3 text-xs text-foreground-secondary">
          <div className="flex-1">
            <p className="font-semibold text-info">Glossaire</p>
            <ul className="mt-1 space-y-0.5">
              <li><strong>FO</strong> = Fourniture (matériaux, produits)</li>
              <li><strong>MO</strong> = Main-d&apos;œuvre (travail, pose)</li>
              <li><strong>K</strong> = Coefficient multiplicateur</li>
              <li><strong>HT</strong> = Hors taxes / <strong>TTC</strong> = Toutes taxes comprises</li>
            </ul>
          </div>
          <IconButton
            label="Masquer le glossaire"
            icon={<XIcon aria-hidden="true" />}
            size="icon-xs"
            className="shrink-0 text-info hover:bg-info-light hover:text-info"
            onClick={() => {
              setGlossaryDismissed(true);
              try { localStorage.setItem(GLOSSARY_DISMISSED_STORAGE_KEY, "1"); } catch {}
            }}
          />
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className={cn(FIELD_CLASS, "sm:col-span-2")}>
          <FieldLabel htmlFor="estimate-project-name">Projet</FieldLabel>
          <Input
            id="estimate-project-name"
            value={projectName}
            readOnly
          />
        </div>

        <div className={cn(FIELD_CLASS, "sm:col-span-2")}>
          <FieldLabel htmlFor="estimate-title">Titre</FieldLabel>
          <Input
            id="estimate-title"
            value={settings.title}
            disabled={isReadOnly}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>

        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="estimate-date">Date devis</FieldLabel>
          <Input
            id="estimate-date"
            type="date"
            value={settings.date_devis}
            disabled={isReadOnly}
            onChange={(event) => onChange({ date_devis: event.target.value })}
          />
        </div>

        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="estimate-validite">Validité (jours)</FieldLabel>
          <NumberInput
            id="estimate-validite"
            className={NUMBER_INPUT_CLASS}
            min={1}
            value={settings.validite_jours}
            disabled={isReadOnly}
            parseValue={parseIntegerNumberInput}
            emptyValue={0}
            onValueChange={(validite_jours) => onChange({ validite_jours })}
          />
        </div>

        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="estimate-version">Version</FieldLabel>
          <Input
            id="estimate-version"
            value={`V${versionNumber}`}
            readOnly
          />
        </div>

        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="estimate-currency">Devise</FieldLabel>
          <NativeSelect
            id="estimate-currency"
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
          </NativeSelect>
        </div>
      </div>

      <div className={cn(FIELD_CLASS, "mt-8")} data-testid="estimate-exclusions-section">
        <FieldLabel htmlFor="estimate-exclusions">
          Précisions et exclusions particulières
        </FieldLabel>
        <FieldDescription id="estimate-exclusions-hint" className="text-xs">
          Indiquez uniquement les prestations, fournitures ou limites propres à cette
          offre. Évitez d&apos;y recopier les règles commerciales déjà prévues par les
          CGV.
        </FieldDescription>
        <Textarea
          id="estimate-exclusions"
          className="min-h-32 resize-y text-sm"
          value={settings.exclusions}
          disabled={isReadOnly}
          maxLength={5000}
          aria-describedby="estimate-exclusions-hint"
          placeholder="Ex. : cordiste, DOE, équilibrage, calorifuge des robinetteries…"
          onChange={(event) => onChange({ exclusions: event.target.value })}
        />
      </div>

      <div className="estimate-settings-grid mt-8 flex flex-col-reverse gap-6 lg:grid lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <div role="group" aria-labelledby="estimate-margin-mode-label">
            <p id="estimate-margin-mode-label" className={GROUP_TITLE_CLASS}>
              Mode de marge
            </p>
            <div className="estimate-chip-row mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={chipClassName(marginMode === "fixed")}
                aria-pressed={marginMode === "fixed"}
                disabled={isReadOnly}
                onClick={() => onChange({ margin_mode: "fixed" })}
              >
                Marge fixe
              </button>
              <button
                type="button"
                className={chipClassName(marginMode === "tiered")}
                aria-pressed={marginMode === "tiered"}
                disabled={isReadOnly}
                onClick={() => onChange({ margin_mode: "tiered" })}
              >
                Marge par tranche
              </button>
            </div>
          </div>

          {marginMode === "fixed" ? (
            <div className={FIELD_CLASS}>
              <FieldLabel htmlFor="estimate-margin">Marge</FieldLabel>
              <div id="estimate-margin-hint" className="space-y-1 text-xs text-muted-foreground">
                <p>Multiplicateur appliqué au coût. Ex. : 1.20 = marge de 20 %.</p>
                <p>Ex. : coût 1 000 € × 1.20 = vente 1 200 € (200 € de marge)</p>
              </div>
              <div className="flex items-center gap-3">
                <NumberInput
                  id="estimate-margin"
                  className={cn(NUMBER_INPUT_CLASS, "flex-1")}
                  step="0.01"
                  min={0}
                  value={settings.margin_multiplier}
                  disabled={isReadOnly}
                  aria-describedby="estimate-margin-hint"
                  parseValue={parseNonNegativeNumberInput}
                  emptyValue={0}
                  onValueChange={(margin_multiplier) =>
                    onChange({ margin_multiplier })
                  }
                />
                <span className="shrink-0 rounded-control border border-border bg-surface-subtle px-3 py-2 text-sm font-medium text-foreground-secondary">
                  {settings.margin_multiplier > 0
                    ? `${((settings.margin_multiplier - 1) * 100).toFixed(0)}%`
                    : "0%"}
                </span>
              </div>
              <div
                role="group"
                aria-label="Coefficients de marge suggérés"
                className="estimate-chip-row mt-1 flex flex-wrap gap-2"
              >
                {MARGIN_SUGGESTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={chipClassName(settings.margin_multiplier === value)}
                    aria-pressed={settings.margin_multiplier === value}
                    onClick={() => onChange({ margin_multiplier: value })}
                    disabled={isReadOnly}
                  >
                    {formatMarginMultiplier(value)}
                    <span className="sr-only">
                      {` (marge de ${((value - 1) * 100).toFixed(0)} %)`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <p className={GROUP_TITLE_CLASS}>Tranches configurées</p>
              <MarginTiersExplanation
                tiers={marginTiers}
                currency={settings.currency}
                costSubtotalCents={totals?.costSubtotalCents}
                isFrozen={isFrozen}
                storedMarginMultiplier={isFrozen ? storedMarginMultiplier : undefined}
              />
              <p className="mb-3 text-xs text-muted-foreground">
                {isFrozen
                  ? "Barème actuel, présenté à titre d'information : il ne recalcule pas ce devis figé."
                  : settings.margin_tiers?.length
                  ? "Barème de votre organisation."
                  : "Barème par défaut, faute de tranches définies pour votre organisation."}
                {" "}Un administrateur peut modifier le barème dans la section
                « Tranches de marge » ci-dessous.
              </p>
              {marginTiers.length > 0 ? (
                <div className="space-y-2">
                  {marginTiers.map((tier) => (
                    <div
                      key={`${tier.id ?? "tier"}-${tier.position ?? tier.threshold_cents}-${tier.threshold_cents}-${tier.multiplier}`}
                      className="estimate-summary__row"
                    >
                      <span>
                        À partir de{" "}
                        {formatCurrency(tier.threshold_cents, settings.currency)}
                      </span>
                      <strong>×{formatMarginMultiplier(tier.multiplier)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucune tranche de marge configurée.
                </p>
              )}
            </div>
          )}

          <div>
            {discountMode === "simple" ? (
              <div className={FIELD_CLASS}>
                <FieldLabel htmlFor="estimate-discount">
                  Remise ({settings.currency} HT)
                </FieldLabel>
                <NumberInput
                  id="estimate-discount"
                  className={NUMBER_INPUT_CLASS}
                  step="0.01"
                  min={0}
                  value={(settings.discount_amount_cents ??
                    (settings.discount_bp != null ? totals?.discountCents : undefined) ??
                    settings.discount_cents) / 100}
                  disabled={isReadOnly}
                  formatValue={(amount) => String(amount ?? "").replace(".", settings.currency === "EUR" ? "," : ".")}
                  parseValue={(raw) => {
                    const cents = parseCurrencyToCents(raw, settings.currency);
                    return cents === null || cents < 0 ? null : cents / 100;
                  }}
                  emptyValue={0}
                  onValueChange={(discountEuros) =>
                    onChange({
                      discount_mode: "simple",
                      discount_steps: [],
                      discount_cents: Math.round(discountEuros * 100),
                      discount_amount_cents: Math.round(discountEuros * 100),
                    })
                  }
                />
                {settings.discount_amount_cents == null && (settings.discount_bp ?? 0) > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Remise historique de {(settings.discount_bp ?? 0) / 100} % : elle suit le montant du devis.
                    Une nouvelle saisie fixe la remise en montant.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface-subtle p-3">
                <p className="mb-2 text-sm font-semibold text-foreground">Remises historiques conservées</p>
                <p className="text-sm text-muted-foreground">
                  Ce devis conserve ses remises successives et son coefficient
                  global. Ils restent en lecture seule pour préserver les montants.
                </p>
                <p className="mt-2 text-sm text-foreground">
                  Coefficient global : ×{globalCoefficient.toFixed(2)}
                  {(settings.discount_steps ?? []).length > 0
                    ? ` · Remises : ${(settings.discount_steps ?? []).map((step) => `${step / 100} %`).join(" puis ")}`
                    : " · Aucune remise"}
                </p>
              </div>
            )}
          </div>
          <div className={FIELD_CLASS}>
            <FieldLabel htmlFor="estimate-contractor-role">Régime de TVA</FieldLabel>
            <NativeSelect
              id="estimate-contractor-role"
              disabled={isReadOnly}
              value={settings.contractor_role ?? "principal"}
              aria-describedby="estimate-contractor-role-hint"
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
                Autoliquidation — travaux immobiliers sous-traités éligibles
              </option>
            </NativeSelect>
            <div id="estimate-contractor-role-hint" className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {settings.contractor_role === "subcontractor"
                  ? "À sélectionner uniquement pour une sous-traitance de travaux immobiliers relevant de l’article 283, 2 nonies du CGI. Le devis est alors émis hors taxe avec la mention « Autoliquidation » ; la TVA est due par le preneur."
                  : "Régime normal : la TVA est facturée au taux applicable."}
              </p>
              {settings.contractor_role === "subcontractor" ? (
                <p className="text-xs font-medium text-warning">
                  Vérifiez le contrat : le nettoyage faisant l’objet d’un contrat
                  séparé, la fabrication ou fourniture de biens, la location
                  d’engins et les prestations intellectuelles ne relèvent pas
                  automatiquement de ce régime.
                </p>
              ) : null}
            </div>
            {/*
              EST-E27 — D2 : le logiciel PROPOSE le régime, il ne le déduit
              jamais. Les exclusions du dispositif (nettoyage sous contrat
              séparé, fabrication de matériaux, prestations intellectuelles,
              location d'engins) dépendent de la nature du CONTRAT, que
              l'application ne connaît pas. L'arbitrage revient à l'utilisateur.
            */}
          </div>

          <div className={FIELD_CLASS}>
            <FieldLabel htmlFor="estimate-tax">TVA unique</FieldLabel>
            <div className="flex flex-wrap items-center gap-3">
              <label className="estimate-toggle">
                <input
                  type="checkbox"
                  className="accent-primary"
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
                <span>Appliquer la TVA</span>
              </label>
              <div className="estimate-tax-input">
                <NumberInput
                  id="estimate-tax"
                  className={cn(NUMBER_INPUT_CLASS, "w-32")}
                  step="0.01"
                  min={0}
                  value={taxRatePercent}
                  // 2.3 review : le taux se lit comme à l'import (« 5,5 % », deux décimales, ≤ 100).
                  parseValue={parseRatePercentDraft}
                  emptyValue={0}
                  onValueChange={(taxRatePercentValue) =>
                    onChange({
                      tax_rate_bp: Math.round(taxRatePercentValue * 100),
                    })
                  }
                  disabled={!taxEnabled || isReadOnly}
                />
                <span aria-hidden="true" className="estimate-tax-suffix">%</span>
              </div>
            </div>
          </div>

          <div className={FIELD_CLASS}>
            <FieldLabel htmlFor="estimate-rounding">Arrondi</FieldLabel>
            <NativeSelect
              id="estimate-rounding"
              value={roundingValue}
              disabled={isReadOnly}
              aria-describedby="estimate-rounding-hint"
              onChange={(event) => {
                const option = roundingOptions.find((entry) => entry.value === event.target.value);
                if (!option || option.preserved) return;
                onChange({
                  rounding_mode: option.mode,
                  rounding_step_cents: option.step,
                });
              }}
            >
              {roundingOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.preserved}
                >
                  {option.label}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription id="estimate-rounding-hint" className="text-xs">
              Les nouveaux choix arrondissent le TTC au palier inférieur, sans
              descendre sous le HT. Un montant déjà exact reste inchangé.
              L’arrondi ne s’applique pas en autoliquidation.
            </FieldDescription>
          </div>
        </div>

        <div className="estimate-summary lg:sticky lg:top-8 lg:self-start">
          <div className="estimate-summary__header">
            <h3>Résumé</h3>
            <p>Calculs en temps réel</p>
          </div>

          {totals ? (
            <div className="estimate-summary__list">
              <div className="estimate-summary__row">
                <span>Coût total</span>
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
                <span>Marge appliquée</span>
                <strong>
                  ×{formatMarginMultiplier(totals.appliedMarginMultiplier)}
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
                  {formatCurrency(
                    totals.adjustedTaxCents - totals.roundingAdjustmentCents,
                    settings.currency,
                  )}
                </strong>
              </div>
              {totals.roundingAdjustmentCents !== 0 ? (
                <>
                  <div className="estimate-summary__row">
                    <span>TTC calculé</span>
                    <strong>
                      {formatCurrency(
                        totals.roundedTtcCents -
                          totals.roundingAdjustmentCents,
                        settings.currency,
                      )}
                    </strong>
                  </div>
                  <div className="estimate-summary__row">
                    <span>Arrondi commercial</span>
                    <strong>
                      {totals.roundingAdjustmentCents > 0 ? "+" : "−"}
                      {formatCurrency(
                        Math.abs(totals.roundingAdjustmentCents),
                        settings.currency,
                      )}
                    </strong>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Optionnel, cet ajustement s’applique uniquement au total TTC
                    à payer.
                  </p>
                </>
              ) : null}
              <div className="estimate-summary__row estimate-summary__row--total">
                <span>TTC à payer</span>
                <strong>
                  {formatCurrency(totals.roundedTtcCents, settings.currency)}
                </strong>
              </div>
            </div>
          ) : (
            <p role="status" className="estimate-summary__placeholder">Chargement…</p>
          )}

          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
            onClick={onSave}
            disabled={isSaving || isReadOnly}
            aria-busy={isSaving || undefined}
          >
            {isReadOnly ? (
              "Lecture seule"
            ) : isSaving ? (
              <>
                <Loader2Icon
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
                Enregistrement…
              </>
            ) : (
              "Enregistrer le paramétrage"
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
