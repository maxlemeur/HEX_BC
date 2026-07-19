"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useOptionalUserContext } from "@/components/UserContext";
import { Modal } from "@/components/ui/Modal";
import { fetchEstimatePdfLayoutConfiguration } from "@/lib/estimates/client";
import {
  applyEstimateTermsPolicy,
  DEFAULT_ESTIMATE_PDF_LAYOUT,
  ESTIMATE_PDF_LAYOUT_STORAGE_VERSION,
  ESTIMATE_PDF_PRESETS,
  estimateEstimatePdfPageCount,
  normalizeEstimatePdfLayoutOptions,
  type EstimatePdfLayoutConfiguration,
  type EstimatePdfLayoutOptions,
  type EstimatePdfPreset,
} from "@/lib/estimates/pdf-layout";

type EstimatePdfLayoutModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  initialLayout?: EstimatePdfLayoutOptions;
  confirmLabel?: string;
  onConfirm: (layout: EstimatePdfLayoutOptions) => Promise<void> | void;
};

const PRESET_OPTIONS: Array<{
  value: EstimatePdfPreset;
  label: string;
  description: string;
  badge?: string;
}> = [
  {
    value: "client_detailed",
    label: "Devis détaillé",
    description: "Toutes les prestations, avec prix unitaires et totaux.",
    badge: "Recommandé",
  },
  {
    value: "decision_summary",
    label: "Devis synthétique",
    description: "Chapitres et sous-totaux, sans le détail de chaque ligne.",
  },
  {
    value: "fo_mo",
    label: "Fournitures + main-d’œuvre",
    description: "Sépare les prix de vente fournitures et main-d’œuvre.",
  },
];

function buildStorageKey(tenantId: string | null, userEmail: string | null) {
  return [
    "estimate-pdf-layout",
    `v${ESTIMATE_PDF_LAYOUT_STORAGE_VERSION}`,
    tenantId ?? "tenant-inconnu",
    userEmail ?? "utilisateur-inconnu",
  ].join(":");
}

function matchesPreset(
  layout: EstimatePdfLayoutOptions,
  preset: EstimatePdfPreset
) {
  const candidate = ESTIMATE_PDF_PRESETS[preset];
  return (
    layout.detailLevel === candidate.detailLevel &&
    layout.priceMode === candidate.priceMode &&
    layout.density === candidate.density &&
    layout.showNumbering === candidate.showNumbering &&
    layout.showSectionSubtotals === candidate.showSectionSubtotals
  );
}

function describeVisibleContent(layout: EstimatePdfLayoutOptions) {
  if (layout.detailLevel === "lines") return "Lignes détaillées";
  if (layout.detailLevel === 1) return "Chapitres de niveau 1";
  return `Chapitres jusqu’au niveau ${layout.detailLevel}`;
}

function describeVisiblePrices(layout: EstimatePdfLayoutOptions) {
  if (layout.priceMode === "total_only") return "Total HT";
  if (layout.priceMode === "fo_mo_and_total") {
    return "Fournitures + main-d’œuvre + total";
  }
  return "Prix unitaires + total HT";
}

export function EstimatePdfLayoutModal({
  open,
  onOpenChange,
  versionId,
  initialLayout = DEFAULT_ESTIMATE_PDF_LAYOUT,
  confirmLabel = "Générer le PDF",
  onConfirm,
}: Readonly<EstimatePdfLayoutModalProps>) {
  const userContext = useOptionalUserContext();
  const storageKey = useMemo(
    () => buildStorageKey(userContext?.tenantId ?? null, userContext?.userEmail ?? null),
    [userContext?.tenantId, userContext?.userEmail]
  );
  const [layout, setLayout] = useState(() =>
    normalizeEstimatePdfLayoutOptions(initialLayout)
  );
  const [configuration, setConfiguration] =
    useState<EstimatePdfLayoutConfiguration | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [isLoadingConfiguration, setIsLoadingConfiguration] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hasStoredPreferenceRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    setSubmitError(null);
    hasStoredPreferenceRef.current = false;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        hasStoredPreferenceRef.current = true;
        setLayout(normalizeEstimatePdfLayoutOptions(JSON.parse(stored), initialLayout));
      } else {
        setLayout(normalizeEstimatePdfLayoutOptions(initialLayout));
      }
    } catch {
      setLayout(normalizeEstimatePdfLayoutOptions(initialLayout));
    }
  }, [initialLayout, open, storageKey]);

  useEffect(() => {
    if (!open) return;

    let active = true;
    setIsLoadingConfiguration(true);
    setConfigurationError(null);
    void fetchEstimatePdfLayoutConfiguration(versionId)
      .then((nextConfiguration) => {
        if (!active) return;
        setConfiguration(nextConfiguration);
        setLayout((current) => {
          const withTenantDefault =
            nextConfiguration.terms.available &&
            nextConfiguration.terms.policy === "default" &&
            !hasStoredPreferenceRef.current
              ? { ...current, includeTerms: true }
              : current;
          return applyEstimateTermsPolicy(
            withTenantDefault,
            nextConfiguration.terms
          );
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setConfiguration(null);
        setConfigurationError(
          error instanceof Error
            ? error.message
            : "Options de mise en page indisponibles."
        );
      })
      .finally(() => {
        if (active) setIsLoadingConfiguration(false);
      });

    return () => {
      active = false;
    };
  }, [open, versionId]);

  const activePreset = PRESET_OPTIONS.find((preset) =>
    matchesPreset(layout, preset.value)
  )?.value;
  const estimatedPageCount = estimateEstimatePdfPageCount(layout, configuration);
  const termsRequired = configuration?.terms.policy === "required";
  const termsAvailable = configuration?.terms.available === true;
  const hasConditions = configuration?.hasConditions !== false;

  const applyPreset = (preset: EstimatePdfPreset) => {
    setLayout((current) => ({
      ...ESTIMATE_PDF_PRESETS[preset],
      conditionsPlacement: current.conditionsPlacement,
      includeTerms: current.includeTerms,
    }));
  };

  const handleConfirm = async () => {
    if (isSubmitting) return;
    const effectiveLayout = configuration
      ? applyEstimateTermsPolicy(layout, configuration.terms)
      : { ...layout, includeTerms: false };

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(effectiveLayout));
      await onConfirm(effectiveLayout);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Impossible de générer le document."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden p-0"
        containerClassName="sm:max-w-4xl"
      >
        <Modal.Header className="shrink-0 border-b border-slate-200 px-6 py-5">
          <div>
            <Modal.Title>Préparer le devis PDF</Modal.Title>
            <p className="mt-1 text-sm text-slate-500">
              Choisissez ce que votre client verra dans le document.
            </p>
          </div>
          <Modal.Close aria-label="Fermer la préparation du PDF">Fermer</Modal.Close>
        </Modal.Header>

        <Modal.Body className="min-h-0 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">
                Quel niveau d’information transmettre ?
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {PRESET_OPTIONS.map((preset) => {
                  const selected = activePreset === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      className={`relative min-h-28 rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue ${
                        selected
                          ? "border-brand-blue bg-blue-50/80 shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                      aria-pressed={selected}
                      data-modal-autofocus={
                        selected || (!activePreset && preset.value === "client_detailed")
                          ? "true"
                          : undefined
                      }
                      onClick={() => applyPreset(preset.value)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="block text-sm font-semibold text-slate-900">
                          {preset.label}
                        </span>
                        {preset.badge ? (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800">
                            {preset.badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-slate-600">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <section
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
              aria-labelledby="estimate-pdf-summary-title"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
                <div className="min-w-40">
                  <p
                    id="estimate-pdf-summary-title"
                    className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-orange"
                  >
                    Votre PDF
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">
                    {estimatedPageCount === null
                      ? "Estimation en cours"
                      : `${estimatedPageCount} page${estimatedPageCount > 1 ? "s" : ""} estimée${estimatedPageCount > 1 ? "s" : ""}`}
                  </p>
                </div>

                <dl className="grid min-w-0 flex-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-slate-500">Contenu</dt>
                    <dd className="mt-1 font-medium text-slate-800">
                      {describeVisibleContent(layout)}
                      {layout.detailLevel === "lines" && configuration?.lineCount
                        ? ` (${configuration.lineCount})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Prix affichés</dt>
                    <dd className="mt-1 font-medium text-slate-800">
                      {describeVisiblePrices(layout)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Pages jointes</dt>
                    <dd className="mt-1 font-medium text-slate-800">
                      {[
                        hasConditions && layout.conditionsPlacement === "new_page"
                          ? "Précisions"
                          : null,
                        layout.includeTerms ? "CGV" : null,
                      ]
                        .filter(Boolean)
                        .join(" + ") || "Aucune"}
                    </dd>
                  </div>
                </dl>
              </div>

              {isLoadingConfiguration ? (
                <p className="mt-3 text-xs text-slate-500" role="status">
                  Chargement des informations du devis…
                </p>
              ) : null}
              {configurationError ? (
                <p className="mt-3 text-xs font-medium text-amber-700" role="status">
                  {configurationError} Les CGV restent désactivées, mais le PDF peut être généré.
                </p>
              ) : null}
            </section>

            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">
                Pages complémentaires
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex min-h-16 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 has-[:disabled]:border-slate-100 has-[:disabled]:bg-slate-50 has-[:disabled]:text-slate-400">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={layout.conditionsPlacement === "new_page"}
                    disabled={!hasConditions}
                    onChange={(event) =>
                      setLayout((current) => ({
                        ...current,
                        conditionsPlacement: event.target.checked
                          ? "new_page"
                          : "auto",
                      }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">
                      Précisions sur une page séparée
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      Sinon, elles suivent directement les totaux.
                    </span>
                  </span>
                </label>

                <label className="flex min-h-16 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 has-[:disabled]:border-slate-100 has-[:disabled]:bg-slate-50 has-[:disabled]:text-slate-400">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={layout.includeTerms}
                    disabled={!termsAvailable || termsRequired}
                    onChange={(event) =>
                      setLayout((current) => ({
                        ...current,
                        includeTerms: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">
                      Joindre les CGV
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {termsRequired
                        ? "Obligatoire pour votre organisation."
                        : termsAvailable
                          ? `${configuration?.terms.title ?? "CGV"} — version ${configuration?.terms.version ?? "-"}`
                          : "Aucun modèle validé n’est configuré."}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-blue">
                <span className="ml-1">Personnaliser le contenu et la présentation</span>
                <span
                  className={`ml-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    activePreset
                      ? "bg-slate-100 text-slate-600"
                      : "bg-orange-100 text-orange-800"
                  }`}
                >
                  {activePreset ? "Réglages du modèle" : "Personnalisé"}
                </span>
              </summary>

              <div className="space-y-4 border-t border-slate-200 p-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    <span>Contenu visible</span>
                    <select
                      className="form-input form-select w-full bg-white"
                      value={String(layout.detailLevel)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setLayout((current) => ({
                          ...current,
                          detailLevel:
                            value === "lines"
                              ? "lines"
                              : (Number(value) as 1 | 2 | 3 | 4),
                        }));
                      }}
                    >
                      <option value="1">Chapitres niveau 1</option>
                      <option value="2">Chapitres niveaux 1 et 2</option>
                      <option value="3">Chapitres jusqu’au niveau 3</option>
                      <option value="4">Chapitres jusqu’au niveau 4</option>
                      <option value="lines">Toutes les lignes</option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    <span>Colonnes de prix</span>
                    <select
                      className="form-input form-select w-full bg-white"
                      value={layout.priceMode}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          priceMode:
                            event.target.value as EstimatePdfLayoutOptions["priceMode"],
                        }))
                      }
                    >
                      <option value="total_only">Total HT uniquement</option>
                      <option value="unit_and_total">Prix unitaires + total HT</option>
                      <option value="fo_mo_and_total">
                        Fournitures + main-d’œuvre + total
                      </option>
                    </select>
                  </label>

                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    <span>Confort de lecture</span>
                    <select
                      className="form-input form-select w-full bg-white"
                      value={layout.density}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          density:
                            event.target.value as EstimatePdfLayoutOptions["density"],
                        }))
                      }
                    >
                      <option value="compact">Compact</option>
                      <option value="standard">Standard</option>
                      <option value="comfortable">Aéré</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={layout.showNumbering}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          showNumbering: event.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-medium text-slate-700">
                      Numéroter les chapitres
                    </span>
                  </label>

                  <label className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={layout.showSectionSubtotals}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          showSectionSubtotals: event.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-medium text-slate-700">
                      Afficher les sous-totaux
                    </span>
                  </label>
                </div>
              </div>
            </details>
          </div>
        </Modal.Body>

        <Modal.Footer className="shrink-0 border-t border-slate-200 px-6 py-4">
          {submitError ? (
            <p className="mr-auto text-sm font-medium text-red-700" role="alert">
              {submitError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleConfirm()}
            disabled={isSubmitting || isLoadingConfiguration}
          >
            {isSubmitting ? "Génération…" : confirmLabel}
          </button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
