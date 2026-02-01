"use client";

import { formatEUR } from "@/lib/money";
import type { EstimateTotals, RoundingMode } from "@/lib/estimate-calculations";

export type EstimateSettingsState = {
  title: string;
  date_devis: string;
  validite_jours: number;
  margin_multiplier: number;
  discount_cents: number;
  tax_rate_bp: number;
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

const ROUNDING_OPTIONS = [
  { label: "Aucun", mode: "none" as const, step: 1 },
  { label: "1 EUR", mode: "nearest" as const, step: 100 },
  { label: "10 EUR", mode: "nearest" as const, step: 1000 },
  { label: "50 EUR", mode: "nearest" as const, step: 5000 },
  { label: "100 EUR", mode: "nearest" as const, step: 10000 },
];

function getRoundingValue(mode: RoundingMode, step: number) {
  if (mode === "none") return "none";
  const match = ROUNDING_OPTIONS.find(
    (option) => option.mode === mode && option.step === step
  );
  return match ? `${match.step}` : "none";
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
  const taxEnabled = settings.tax_rate_bp > 0;
  const taxRatePercent = settings.tax_rate_bp / 100;
  const roundingValue = getRoundingValue(
    settings.rounding_mode,
    settings.rounding_step_cents
  );

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
          <input
            id="estimate-validite"
            className="form-input"
            type="number"
            min={1}
            value={settings.validite_jours}
            disabled={isReadOnly}
            onChange={(event) =>
              onChange({
                validite_jours: Number(event.target.value || 0),
              })
            }
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
      </div>

      <div className="estimate-settings-grid mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <label className="form-label" htmlFor="estimate-margin">
              Marge (multiplicateur)
            </label>
          <input
            id="estimate-margin"
            className="form-input"
            type="number"
            step="0.01"
            min={0}
            value={settings.margin_multiplier}
            disabled={isReadOnly}
            onChange={(event) =>
              onChange({
                margin_multiplier: Number(event.target.value || 0),
              })
            }
          />
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
              >
                {value.toFixed(2)}
              </button>
            ))}
          </div>
        </div>

          <div>
            <label className="form-label" htmlFor="estimate-discount">
              Remise (EUR HT)
            </label>
          <input
            id="estimate-discount"
            className="form-input"
            type="number"
            step="0.01"
            min={0}
            value={settings.discount_cents / 100}
            disabled={isReadOnly}
            onChange={(event) =>
              onChange({
                discount_cents: Math.round(
                  Number(event.target.value || 0) * 100
                  ),
                })
              }
            />
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
                <input
                  id="estimate-tax"
                  className="form-input"
                  type="number"
                  step="0.01"
                  min={0}
                  value={taxRatePercent}
                  onChange={(event) =>
                    onChange({
                      tax_rate_bp: Math.round(
                        Number(event.target.value || 0) * 100
                      ),
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
              {ROUNDING_OPTIONS.map((option) => (
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

        <div className="estimate-summary">
          <div className="estimate-summary__header">
            <h3>Resume</h3>
            <p>Calculs temps reel</p>
          </div>

          {totals ? (
            <div className="estimate-summary__list">
              <div className="estimate-summary__row">
                <span>Cout total</span>
                <strong>{formatEUR(totals.costSubtotalCents)}</strong>
              </div>
              <div className="estimate-summary__row">
                <span>Vente HT</span>
                <strong>{formatEUR(totals.saleSubtotalCents)}</strong>
              </div>
              <div className="estimate-summary__row">
                <span>Remise</span>
                <strong>-{formatEUR(totals.discountCents)}</strong>
              </div>
              <div className="estimate-summary__row estimate-summary__row--bold">
                <span>Total HT</span>
                <strong>{formatEUR(totals.saleTotalCents)}</strong>
              </div>
              <div className="estimate-summary__row">
                <span>TVA</span>
                <strong>{formatEUR(totals.adjustedTaxCents)}</strong>
              </div>
              <div className="estimate-summary__row">
                <span>Ajustement arrondi</span>
                <strong>{formatEUR(totals.roundingAdjustmentCents)}</strong>
              </div>
              <div className="estimate-summary__row estimate-summary__row--total">
                <span>Total TTC</span>
                <strong>{formatEUR(totals.roundedTtcCents)}</strong>
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
