"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useOptionalUserContext } from "@/components/UserContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import {
  acquireEstimateDraftLock,
  fetchEstimatePdfLayoutConfiguration,
  isEstimateApiError,
  releaseEstimateDraftLock,
  renewEstimateDraftLock,
} from "@/lib/estimates/client";
import { DRAFT_LOCK_HEARTBEAT_INTERVAL_MS } from "@/hooks/useDraftLock";
import { hasEstimateEditorMutationSession } from "@/lib/estimates/editor-mutations";
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
} & ({ requiresDraftLock: true } | { requiresDraftLock?: false });

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
  requiresDraftLock = false,
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
  const [ownsDraftLock, setOwnsDraftLock] = useState(false);
  const [draftLockError, setDraftLockError] = useState<string | null>(null);
  const leaseQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hasStoredPreferenceRef = useRef(false);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOwnsDraftLock(false);
    setDraftLockError(null);
    if (!open || !requiresDraftLock) return;

    let active = true;
    let ownsNewLease = false;
    let leaseReady = false;
    let intervalId: number | undefined;
    const enqueue = (operation: () => Promise<void>) => {
      const next = leaseQueueRef.current.catch(() => undefined).then(operation);
      leaseQueueRef.current = next;
      return next;
    };
    const releaseNewLease = () => {
      if (!ownsNewLease) return;
      ownsNewLease = false;
      void enqueue(async () => {
        await releaseEstimateDraftLock(versionId, { keepalive: true });
      }).catch(() => undefined);
    };
    const block = (error: unknown) => {
      leaseReady = false;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      if (!active) return;
      setOwnsDraftLock(false);
      setDraftLockError(error instanceof Error ? error.message : "Ce devis n’est pas disponible pour préparer un PDF.");
    };
    const renew = () => {
      if (!active || !leaseReady) return;
      void enqueue(async () => {
        if (!active || !leaseReady) return;
        try {
          const result = await renewEstimateDraftLock(versionId);
          if (!result.renewed || result.lock?.isOwnedByCurrentSession !== true) {
            throw new Error("Ce devis est ouvert dans une autre page. Fermez cette préparation et réessayez quand il sera disponible.");
          }
        } catch (error) { block(error); }
      });
    };

    void enqueue(async () => {
      if (!active) return;
      try {
        // Borrow the editor's existing page lease without releasing it later.
        try {
          const existing = await renewEstimateDraftLock(versionId);
          if (!existing.renewed || existing.lock?.isOwnedByCurrentSession !== true) {
            throw new Error("Ce devis est déjà ouvert dans une autre page. Réessayez quand il sera disponible.");
          }
        } catch (error) {
          if (!isEstimateApiError(error) || error.status !== 404) throw error;
          if (!active) return;
          const acquired = await acquireEstimateDraftLock(versionId);
          if (!acquired.acquired || acquired.lock?.isOwnedByCurrentSession !== true) {
            throw new Error("Ce devis est déjà ouvert dans une autre page. Réessayez quand il sera disponible.");
          }
          // The editor may finish acquiring the same page lease while this
          // request is pending. Its lifecycle still owns release in that case.
          ownsNewLease = !hasEstimateEditorMutationSession(versionId);
        }
        if (!active) {
          if (ownsNewLease) {
            ownsNewLease = false;
            await releaseEstimateDraftLock(versionId, { keepalive: true });
          }
          return;
        }
        leaseReady = true;
        setOwnsDraftLock(true);
        intervalId = window.setInterval(renew, DRAFT_LOCK_HEARTBEAT_INTERVAL_MS);
      } catch (error) { block(error); }
    });

    const refreshLease = () => { if (document.visibilityState !== "hidden") renew(); };
    window.addEventListener("focus", refreshLease);
    document.addEventListener("visibilitychange", refreshLease);
    window.addEventListener("beforeunload", releaseNewLease);
    return () => {
      active = false;
      leaseReady = false;
      if (intervalId !== undefined) window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshLease);
      document.removeEventListener("visibilitychange", refreshLease);
      window.removeEventListener("beforeunload", releaseNewLease);
      releaseNewLease();
    };
  }, [open, requiresDraftLock, versionId]);

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
    if (requiresDraftLock && !ownsDraftLock) {
      setSubmitError("Attendez la disponibilité du devis avant de préparer le PDF.");
      return;
    }
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

  const checkboxCardClass =
    "flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:border-border-subtle has-[:disabled]:bg-surface-subtle has-[:disabled]:text-muted-foreground";

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        size="xl"
        className="gap-0 overflow-hidden p-0 sm:p-0"
        initialFocus={initialFocusRef}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>Préparer le devis PDF</DialogTitle>
          <DialogDescription>
            Choisissez ce que votre client verra dans le document.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-semibold text-foreground">
                Quel niveau d’information transmettre ?
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {PRESET_OPTIONS.map((preset) => {
                  const selected = activePreset === preset.value;
                  const isInitialFocus =
                    selected || (!activePreset && preset.value === "client_detailed");
                  return (
                    <button
                      key={preset.value}
                      ref={isInitialFocus ? initialFocusRef : undefined}
                      type="button"
                      className={`relative min-h-28 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none ${
                        selected
                          ? "border-primary bg-info-subtle shadow-sm"
                          : "border-border bg-surface hover:border-border-strong hover:bg-surface-subtle"
                      }`}
                      aria-pressed={selected}
                      onClick={() => applyPreset(preset.value)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="block text-sm font-semibold text-foreground">
                          {preset.label}
                        </span>
                        {preset.badge ? (
                          <Badge variant="accent" size="sm" className="uppercase tracking-wide">
                            {preset.badge}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-foreground-secondary">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <section
              className="rounded-lg border border-border bg-surface-subtle px-4 py-4"
              aria-labelledby="estimate-pdf-summary-title"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
                <div className="min-w-40">
                  <p
                    id="estimate-pdf-summary-title"
                    className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-orange-dark"
                  >
                    Votre PDF
                  </p>
                  <p className="mt-1 text-lg font-semibold text-foreground">
                    {estimatedPageCount === null
                      ? "Estimation en cours"
                      : `${estimatedPageCount} page${estimatedPageCount > 1 ? "s" : ""} estimée${estimatedPageCount > 1 ? "s" : ""}`}
                  </p>
                </div>

                <dl className="grid min-w-0 flex-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Contenu</dt>
                    <dd className="mt-1 font-medium text-foreground">
                      {describeVisibleContent(layout)}
                      {layout.detailLevel === "lines" && configuration?.lineCount
                        ? ` (${configuration.lineCount})`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Prix affichés</dt>
                    <dd className="mt-1 font-medium text-foreground">
                      {describeVisiblePrices(layout)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Pages jointes</dt>
                    <dd className="mt-1 font-medium text-foreground">
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
                <p className="mt-3 text-xs text-muted-foreground" role="status">
                  Chargement des informations du devis…
                </p>
              ) : null}
              {configurationError ? (
                <p className="mt-3 text-xs font-medium text-warning" role="status">
                  {configurationError} Les CGV restent désactivées, mais le PDF peut être généré.
                </p>
              ) : null}
            </section>

            <fieldset>
              <legend className="text-sm font-semibold text-foreground">
                Pages complémentaires
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className={checkboxCardClass}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
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
                    <span className="block text-sm font-medium text-foreground">
                      Précisions sur une page séparée
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      Sinon, elles suivent directement les totaux.
                    </span>
                  </span>
                </label>

                <label className={checkboxCardClass}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
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
                    <span className="block text-sm font-medium text-foreground">
                      Joindre les CGV
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
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

            <details className="rounded-lg border border-border bg-surface">
              <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold text-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                <span className="ml-1">Personnaliser le contenu et la présentation</span>
                <Badge
                  variant={activePreset ? "neutral" : "accent"}
                  size="sm"
                  className="ml-3 uppercase tracking-wide"
                >
                  {activePreset ? "Réglages du modèle" : "Personnalisé"}
                </Badge>
              </summary>

              <div className="space-y-4 border-t border-border p-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <FieldLabel htmlFor="estimate-pdf-detail-level">Contenu visible</FieldLabel>
                    <NativeSelect
                      id="estimate-pdf-detail-level"
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
                    </NativeSelect>
                  </div>

                  <div className="grid gap-2">
                    <FieldLabel htmlFor="estimate-pdf-price-mode">Colonnes de prix</FieldLabel>
                    <NativeSelect
                      id="estimate-pdf-price-mode"
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
                    </NativeSelect>
                  </div>

                  <div className="grid gap-2">
                    <FieldLabel htmlFor="estimate-pdf-density">Confort de lecture</FieldLabel>
                    <NativeSelect
                      id="estimate-pdf-density"
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
                    </NativeSelect>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      checked={layout.showNumbering}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          showNumbering: event.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-medium text-foreground-secondary">
                      Numéroter les chapitres
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-surface-subtle px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      checked={layout.showSectionSubtotals}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          showSectionSubtotals: event.target.checked,
                        }))
                      }
                    />
                    <span className="text-sm font-medium text-foreground-secondary">
                      Afficher les sous-totaux
                    </span>
                  </label>
                </div>
              </div>
            </details>
          </div>
        </div>

        <DialogFooter className="mt-0 shrink-0 border-t border-border px-6 py-4">
          {draftLockError ? (
            <p className="text-sm font-medium text-danger sm:mr-auto" role="alert">{draftLockError}</p>
          ) : requiresDraftLock && !ownsDraftLock ? (
            <p className="text-sm text-muted-foreground sm:mr-auto" role="status">Vérification de la disponibilité du devis…</p>
          ) : null}
          {submitError ? (
            <p className="text-sm font-medium text-danger sm:mr-auto" role="alert">
              {submitError}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button
            size="lg"
            onClick={() => void handleConfirm()}
            disabled={isLoadingConfiguration || (requiresDraftLock && !ownsDraftLock)}
            loading={isSubmitting}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
