"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createEstimate,
  fetchAffaireLinkedDpgfSource,
  fetchEstimateTemplates,
  importLinkedDpgfSource,
  instantiateEstimateFromTemplate,
  type AffaireLinkedDpgfSource,
  type EstimateTemplateSummary,
} from "@/lib/estimates/client";
import {
  getMarginTiers,
  type MarginTier,
} from "@/lib/estimates/margin-tiers";
import {
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
} from "@/lib/estimates/schemas";
import { formatEUR } from "@/lib/money";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "est-wizard-draft";
const DEFAULT_VALIDITE_JOURS = 30;
const DEFAULT_TAX_RATE_BP = 2000;

const ROUNDING_OPTIONS = [
  { label: "Aucun", mode: "none" as const, step: 1 },
  { label: "1 EUR", mode: "nearest" as const, step: 100 },
  { label: "10 EUR", mode: "nearest" as const, step: 1000 },
  { label: "50 EUR", mode: "nearest" as const, step: 5000 },
  { label: "100 EUR", mode: "nearest" as const, step: 10000 },
] as const;

const PROJECT_FAMILY_OPTIONS = [
  { value: "", label: "Non renseignee" },
  { value: "Maintenance", label: "Maintenance" },
  { value: "Renovation", label: "Renovation" },
  { value: "Travaux neufs", label: "Travaux neufs" },
  { value: "Mise en conformite", label: "Mise en conformite" },
  { value: "Rehabilitation", label: "Rehabilitation" },
] as const;

const STEPS = [
  { label: "Projet", description: "Informations projet" },
  { label: "Paramètres", description: "Marge, TVA, arrondi" },
  { label: "Import", description: "Import optionnel" },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WizardData = {
  // Step 1
  projectName: string;
  clientName: string;
  reference: string;
  title: string;
  // Step 2
  dateDevis: string;
  validiteJours: string;
  marginMode: "fixed" | "tiered";
  marginBp: string;
  taxRateBp: string;
  roundingMode: "none" | "nearest" | "up" | "down";
  roundingStepCents: string;
  currency: string;
  projectFamily: string;
  // Step 3
  creationMode: "blank" | "template";
  selectedTemplateId: string;
  dpgfImportMode: "none" | "source";
};

type StepErrors = Record<string, string>;

type EstimateCreationWizardProps = {
  onCreated: (versionId: string) => void;
  projectId?: string;
};

const FIELD_STEP_INDEX: Record<keyof WizardData, number> = {
  projectName: 0,
  clientName: 0,
  reference: 0,
  title: 0,
  dateDevis: 1,
  validiteJours: 1,
  marginMode: 1,
  marginBp: 1,
  taxRateBp: 1,
  roundingMode: 1,
  roundingStepCents: 1,
  currency: 1,
  projectFamily: 1,
  creationMode: 2,
  selectedTemplateId: 2,
  dpgfImportMode: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function initialWizardData(): WizardData {
  return {
    projectName: "",
    clientName: "",
    reference: "",
    title: "",
    dateDevis: todayISO(),
    validiteJours: String(DEFAULT_VALIDITE_JOURS),
    marginMode: "fixed",
    marginBp: "0",
    taxRateBp: String(DEFAULT_TAX_RATE_BP),
    roundingMode: "none",
    roundingStepCents: "1",
    currency: "EUR",
    projectFamily: "",
    creationMode: "blank",
    selectedTemplateId: "",
    dpgfImportMode: "none",
  };
}

function loadDraft(): Partial<WizardData> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawImportMode = parsed.dpgfImportMode;
    const normalizedImportMode =
      rawImportMode === "source" || rawImportMode === "later"
        ? "source"
        : "none";

    return {
      ...(parsed as Partial<WizardData>),
      creationMode: parsed.creationMode === "template" ? "template" : "blank",
      selectedTemplateId:
        typeof parsed.selectedTemplateId === "string"
          ? parsed.selectedTemplateId
          : "",
      dpgfImportMode: normalizedImportMode,
    };
  } catch {
    return null;
  }
}

function saveDraft(data: WizardData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota exceeded — ignore
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function buildDpgfImportCreatePayload(
  mode: WizardData["dpgfImportMode"]
): Partial<Parameters<typeof createEstimate>[0]> {
  if (mode !== "source") return {};
  return { creationMode: "linkedDpgfSource" };
}

function hasImportableLinkedDpgfSource(
  source: AffaireLinkedDpgfSource
): source is NonNullable<AffaireLinkedDpgfSource> {
  return Boolean(
    source &&
      source.importStatus === "completed" &&
      source.mappedRowCount > 0
  );
}

function buildProjectNotes(projectFamily: string) {
  const family = projectFamily.trim();
  if (!family) return null;
  return `Famille Achat: ${family}`;
}

function formatDateLabel(isoValue: string) {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseZodErrors(error: unknown): StepErrors {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  ) {
    const zodError = error as { issues: Array<{ path: (string | number)[]; message: string }> };
    const errors: StepErrors = {};
    for (const issue of zodError.issues) {
      const key = String(issue.path[0] ?? "_root");
      if (!errors[key]) errors[key] = issue.message;
    }
    return errors;
  }
  return { _root: "Erreur de validation." };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({
  currentStep,
  validatedSteps,
  onStepClick,
}: {
  currentStep: number;
  validatedSteps: Set<number>;
  onStepClick: (step: number) => void;
}) {
  return (
    <nav aria-label="Étapes de création" className="mb-8">
      <ol className="flex items-center">
        {STEPS.map((step, index) => {
          const isActive = index === currentStep;
          const isValidated = validatedSteps.has(index);
          const isPast = index < currentStep;
          const isClickable = (isPast || isValidated) && !isActive;

          return (
            <li
              key={step.label}
              className={`flex items-center ${index > 0 ? "flex-1" : ""}`}
            >
              {index > 0 && (
                <div
                  className={`h-px flex-1 ${
                    isPast || isValidated
                      ? "bg-[var(--primary)]"
                      : "bg-[var(--slate-200)]"
                  }`}
                />
              )}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(index)}
                className={`flex flex-col items-center gap-1 ${
                  isClickable ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-[var(--primary)] text-white"
                      : isValidated
                        ? "bg-[var(--success)] text-white"
                        : "bg-[var(--slate-100)] text-[var(--slate-500)]"
                  }`}
                >
                  {isValidated && !isActive ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={`text-xs whitespace-nowrap text-center ${
                    isActive
                      ? "font-semibold text-[var(--primary)]"
                      : "text-[var(--slate-500)]"
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

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
          {sorted.map((tier, i) => (
            <tr key={tier.id ?? i}>
              <td>{formatEUR(tier.threshold_cents)}</td>
              <td>x{tier.multiplier.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EstimateCreationWizard({
  onCreated,
  projectId,
}: EstimateCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [validatedSteps, setValidatedSteps] = useState<Set<number>>(
    () => new Set()
  );
  const [data, setData] = useState<WizardData>(() => {
    const draft = loadDraft();
    if (!draft) return initialWizardData();
    return {
      ...initialWizardData(),
      ...draft,
    };
  });
  const [errors, setErrors] = useState<StepErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const projectNameInputRef = useRef<HTMLInputElement | null>(null);

  // Templates
  const [templates, setTemplates] = useState<EstimateTemplateSummary[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [linkedDpgfSource, setLinkedDpgfSource] =
    useState<AffaireLinkedDpgfSource>(null);
  const [isLoadingLinkedDpgfSource, setIsLoadingLinkedDpgfSource] =
    useState(Boolean(projectId));
  const [linkedDpgfSourceError, setLinkedDpgfSourceError] = useState<string | null>(null);
  const hasTemplates = templates.length > 0;
  const templateModeDisabled = !hasTemplates;
  const templateModeUnavailable = !isLoadingTemplates && !hasTemplates;
  const hasLinkedDpgfSource = hasImportableLinkedDpgfSource(linkedDpgfSource);

  // Margin tiers
  const marginTiers = useMemo(() => getMarginTiers(), []);

  // Load templates
  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoadingTemplates(true);
      setTemplatesError(null);
      try {
        const list = await fetchEstimateTemplates({ limit: 10, order: "recent" });
        if (!mounted) return;
        setTemplates(list);
      } catch (err) {
        if (!mounted) return;
        setTemplatesError(
          err instanceof Error ? err.message : "Impossible de charger les templates."
        );
      } finally {
        if (mounted) setIsLoadingTemplates(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    saveDraft(data);
  }, [data]);

  useEffect(() => {
    const targetProjectId = projectId;
    if (!targetProjectId) {
      setLinkedDpgfSource(null);
      setLinkedDpgfSourceError(null);
      setIsLoadingLinkedDpgfSource(false);
      setData((prev) =>
        prev.dpgfImportMode === "source"
          ? { ...prev, dpgfImportMode: "none" }
          : prev
      );
      return;
    }
    const linkedProjectId: string = targetProjectId;

    let mounted = true;
    setIsLoadingLinkedDpgfSource(true);
    setLinkedDpgfSourceError(null);

    async function loadLinkedSource() {
      try {
        const source = await fetchAffaireLinkedDpgfSource(linkedProjectId);
        if (!mounted) return;

        setLinkedDpgfSource(source);
        if (hasImportableLinkedDpgfSource(source)) {
          setData((prev) =>
            prev.dpgfImportMode === "none"
              ? { ...prev, dpgfImportMode: "source" }
              : prev
          );
          return;
        }

        setData((prev) =>
          prev.dpgfImportMode === "source"
            ? { ...prev, dpgfImportMode: "none" }
            : prev
        );
      } catch (error) {
        if (!mounted) return;
        setLinkedDpgfSource(null);
        setLinkedDpgfSourceError(
          error instanceof Error
            ? error.message
            : "Impossible de charger la source DPGF de l'affaire."
        );
      } finally {
        if (mounted) setIsLoadingLinkedDpgfSource(false);
      }
    }

    void loadLinkedSource();

    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (hasTemplates) return;
    setData((prev) => {
      if (prev.creationMode !== "template" || prev.selectedTemplateId) {
        return prev;
      }
      return {
        ...prev,
        creationMode: "blank",
      };
    });
  }, [hasTemplates]);

  useEffect(() => {
    if (!templateModeUnavailable) return;
    setData((prev) => {
      if (prev.creationMode !== "template" && !prev.selectedTemplateId) {
        return prev;
      }
      return {
        ...prev,
        creationMode: "blank",
        selectedTemplateId: "",
      };
    });
    setErrors((prev) => {
      if (!prev.selectedTemplateId) return prev;
      const next = { ...prev };
      delete next.selectedTemplateId;
      return next;
    });
  }, [templateModeUnavailable]);

  useEffect(() => {
    if (currentStep !== 0) return;
    projectNameInputRef.current?.focus();
  }, [currentStep]);

  // Update helper
  const updateField = useCallback(
    <K extends keyof WizardData>(key: K, value: WizardData[K]) => {
      setData((prev) => ({ ...prev, [key]: value }));
      setValidatedSteps((prev) => {
        if (prev.size === 0) return prev;
        const stepIndex = FIELD_STEP_INDEX[key];
        const next = new Set<number>();
        let didChange = false;

        for (const step of prev) {
          if (step < stepIndex) {
            next.add(step);
          } else {
            didChange = true;
          }
        }

        return didChange ? next : prev;
      });
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  // Validation
  const validateStep = useCallback(
    (step: number): boolean => {
      setErrors({});
      try {
        if (step === 0) {
          if (projectId) {
            // No project name validation when adding to existing project
          } else {
            wizardStep1Schema.parse({
              projectName: data.projectName,
              clientName: data.clientName || null,
              reference: data.reference || null,
              title: data.title || null,
            });
          }
        } else if (step === 1) {
          wizardStep2Schema.parse({
            dateDevis: data.dateDevis,
            validiteJours: Number(data.validiteJours),
            marginMode: data.marginMode,
            marginBp: data.marginBp ? Number(data.marginBp) : undefined,
            taxRateBp: Number(data.taxRateBp),
            roundingMode: data.roundingMode,
            roundingStepCents:
              data.roundingMode !== "none"
                ? Number(data.roundingStepCents)
                : undefined,
            currency: data.currency || undefined,
          });
        } else if (step === 2) {
          wizardStep3Schema.parse({
            creationMode: data.creationMode,
            selectedTemplateId:
              data.creationMode === "template"
                ? data.selectedTemplateId || undefined
                : undefined,
          });
        }
        return true;
      } catch (err) {
        setErrors(parseZodErrors(err));
        return false;
      }
    },
    [data, projectId]
  );

  // Navigation
  function goNext() {
    if (!validateStep(currentStep)) return;
    setValidatedSteps((prev) => new Set(prev).add(currentStep));
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  }

  function goBack() {
    setErrors({});
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }

  // Submit
  async function handleSubmit() {
    if (!validateStep(currentStep)) return;
    setValidatedSteps((prev) => new Set(prev).add(currentStep));
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let versionId: string;

      if (data.creationMode === "template" && data.selectedTemplateId) {
        const result = await instantiateEstimateFromTemplate(
          data.selectedTemplateId,
          {
            ...(projectId
              ? { projectId }
              : { projectName: data.projectName.trim() }),
            versionTitle: data.title.trim() || null,
            dateDevis: data.dateDevis,
            validiteJours: Number(data.validiteJours),
            projectNotes: buildProjectNotes(data.projectFamily),
          }
        );
        versionId = result.versionId;
        if (data.dpgfImportMode === "source") {
          await importLinkedDpgfSource(versionId);
        }
      } else {
        const marginBpNum = data.marginBp ? Number(data.marginBp) : 0;
        const dpgfImportPayload = buildDpgfImportCreatePayload(
          data.dpgfImportMode
        );
        versionId = await createEstimate({
          ...(projectId
            ? { projectId }
            : { projectName: data.projectName.trim() }),
          title: data.title.trim() || null,
          dateDevis: data.dateDevis,
          validiteJours: Number(data.validiteJours),
          ...(!projectId && {
            clientName: data.clientName.trim() || null,
            reference: data.reference.trim() || null,
          }),
          marginMode: data.marginMode,
          marginBp: marginBpNum > 0 ? marginBpNum : undefined,
          marginMultiplier: marginBpNum > 0 ? 1 + marginBpNum / 10000 : undefined,
          taxRateBp: Number(data.taxRateBp),
          roundingMode: data.roundingMode,
          roundingStepCents:
            data.roundingMode !== "none"
              ? Number(data.roundingStepCents)
              : undefined,
          currency: data.currency || undefined,
          projectNotes: buildProjectNotes(data.projectFamily),
          ...dpgfImportPayload,
        });
      }

      clearDraft();
      onCreated(versionId);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Impossible de créer le chiffrage."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Quick create (skip wizard)
  async function handleQuickCreate() {
    if (!projectId && !data.projectName.trim()) {
      setErrors({ projectName: "Le nom du projet est obligatoire." });
      setCurrentStep(0);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const versionId = await createEstimate({
        ...(projectId
          ? { projectId }
          : { projectName: data.projectName.trim() }),
        title: null,
        dateDevis: todayISO(),
        validiteJours: DEFAULT_VALIDITE_JOURS,
        projectNotes: buildProjectNotes(data.projectFamily),
      });
      clearDraft();
      onCreated(versionId);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Impossible de créer le chiffrage."
      );
      setIsSubmitting(false);
    }
  }

  // Rounding helper
  function handleRoundingChange(value: string) {
    if (value === "none") {
      updateField("roundingMode", "none");
      updateField("roundingStepCents", "1");
    } else {
      const option = ROUNDING_OPTIONS.find((o) => String(o.step) === value);
      if (option) {
        updateField("roundingMode", option.mode);
        updateField("roundingStepCents", String(option.step));
      }
    }
  }

  function getRoundingValue(): string {
    if (data.roundingMode === "none") return "none";
    return data.roundingStepCents;
  }

  // -------------------------------------------------------------------------
  // Render steps
  // -------------------------------------------------------------------------

  function renderStep1() {
    if (projectId) {
      return (
        <div className="grid gap-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-600">
              Version ajoutee au projet existant.
            </p>
          </div>
          <div>
            <label className="form-label" htmlFor="wiz-title">
              Titre de la version
            </label>
            <input
              id="wiz-title"
              ref={projectNameInputRef}
              className="form-input"
              placeholder="Titre de la version (optionnel)"
              value={data.title}
              onChange={(e) => updateField("title", e.target.value)}
              autoFocus
            />
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="form-label" htmlFor="wiz-project-name">
            Nom du projet *
          </label>
          <input
            id="wiz-project-name"
            ref={projectNameInputRef}
            className={`form-input ${errors.projectName ? "border-[var(--error)]" : ""}`}
            placeholder="Nom du projet"
            value={data.projectName}
            onChange={(e) => updateField("projectName", e.target.value)}
          />
          {errors.projectName && (
            <p className="mt-1 text-sm text-[var(--error)]">{errors.projectName}</p>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor="wiz-client-name">
            Client
          </label>
          <input
            id="wiz-client-name"
            className="form-input"
            placeholder="Nom du client"
            value={data.clientName}
            onChange={(e) => updateField("clientName", e.target.value)}
          />
        </div>

        <div>
          <label className="form-label" htmlFor="wiz-reference">
            Reference
          </label>
          <input
            id="wiz-reference"
            className="form-input"
            placeholder="Ref. projet"
            value={data.reference}
            onChange={(e) => updateField("reference", e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="form-label" htmlFor="wiz-title">
            Titre de la version
          </label>
          <input
            id="wiz-title"
            className="form-input"
            placeholder="Titre de la version (optionnel)"
            value={data.title}
            onChange={(e) => updateField("title", e.target.value)}
          />
        </div>
      </div>
    );
  }

  function renderStep2() {
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
            onChange={(e) => updateField("dateDevis", e.target.value)}
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
            onChange={(e) => updateField("validiteJours", e.target.value)}
          />
          {errors.validiteJours && (
            <p className="mt-1 text-sm text-[var(--error)]">{errors.validiteJours}</p>
          )}
        </div>

        {/* Margin mode */}
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
              <input
                id="wiz-margin-bp"
                className="form-input pr-8"
                type="number"
                step="0.1"
                min={0}
                value={Number(data.marginBp) > 0 ? (Number(data.marginBp) / 100).toString() : ""}
                onChange={(e) => {
                  const percent = Number(e.target.value || 0);
                  updateField("marginBp", String(Math.round(percent * 100)));
                }}
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

        {/* Tax */}
        <div>
          <label className="form-label" htmlFor="wiz-tax-rate">
            TVA (%) *
          </label>
          <div className="relative">
            <input
              id="wiz-tax-rate"
              className={`form-input pr-8 ${errors.taxRateBp ? "border-[var(--error)]" : ""}`}
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={Number(data.taxRateBp) > 0 ? (Number(data.taxRateBp) / 100).toString() : ""}
              onChange={(e) => {
                const percent = Number(e.target.value || 0);
                updateField("taxRateBp", String(Math.round(percent * 100)));
              }}
              placeholder="Ex: 20"
            />
            <span className="estimate-tax-suffix">%</span>
          </div>
          {errors.taxRateBp && (
            <p className="mt-1 text-sm text-[var(--error)]">{errors.taxRateBp}</p>
          )}
        </div>

        {/* Rounding */}
        <div>
          <label className="form-label" htmlFor="wiz-rounding">
            Arrondi
          </label>
          <select
            id="wiz-rounding"
            className="form-input form-select"
            value={getRoundingValue()}
            onChange={(e) => handleRoundingChange(e.target.value)}
          >
            {ROUNDING_OPTIONS.map((opt) => (
              <option
                key={`${opt.mode}-${opt.step}`}
                value={opt.mode === "none" ? "none" : String(opt.step)}
              >
                {opt.label}
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
            onChange={(e) => updateField("projectFamily", e.target.value)}
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

  function renderStep3() {
    return (
      <div className="grid gap-6">
        <div>
          <span className="form-label">Mode de creation</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={
                data.creationMode === "blank"
                  ? "btn btn-primary btn-sm"
                  : "btn btn-secondary btn-sm"
              }
              onClick={() => updateField("creationMode", "blank")}
            >
              Nouveau (vide)
            </button>
            <button
              type="button"
              className={
                templateModeDisabled
                  ? "btn btn-secondary btn-sm cursor-not-allowed opacity-60"
                  : data.creationMode === "template"
                    ? "btn btn-primary btn-sm"
                    : "btn btn-secondary btn-sm"
              }
              onClick={() => {
                if (!templateModeDisabled) updateField("creationMode", "template");
              }}
              disabled={templateModeDisabled}
              aria-disabled={templateModeDisabled}
              title={
                templateModeUnavailable
                  ? "Aucun modèle disponible pour le moment."
                  : undefined
              }
            >
              Depuis un modèle
            </button>
            <Link
              className="btn btn-ghost btn-sm"
              href="/dashboard/estimates/templates"
            >
              Bibliothèque templates
            </Link>
          </div>
          {templateModeUnavailable && (
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Aucun modele disponible actuellement. Creation en mode Nouveau (vide).
            </p>
          )}
        </div>

        {data.creationMode === "template" && (
          <div>
            <label className="form-label" htmlFor="wiz-template-id">
              Template (10 plus recents)
            </label>
            <select
              id="wiz-template-id"
              className={`form-input form-select ${errors.selectedTemplateId ? "border-[var(--error)]" : ""}`}
              value={data.selectedTemplateId}
              onChange={(e) => updateField("selectedTemplateId", e.target.value)}
              disabled={isLoadingTemplates || templates.length === 0}
            >
              {templates.length === 0 ? (
                <option value="">
                  {isLoadingTemplates
                    ? "Chargement..."
                    : "Aucun template disponible"}
                </option>
              ) : (
                <>
                  <option value="">Sélectionnez un template</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} - {tpl.itemCount} lignes -{" "}
                      {formatDateLabel(tpl.createdAt)}
                    </option>
                  ))}
                </>
              )}
            </select>
            {errors.selectedTemplateId && (
              <p className="mt-1 text-sm text-[var(--error)]">
                {errors.selectedTemplateId}
              </p>
            )}
            {templatesError && (
              <div className="alert alert-error mt-3">{templatesError}</div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-[var(--slate-200)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-700)]">
            Import DPGF (optionnel)
          </h3>
          <p className="mt-2 text-sm text-[var(--slate-500)]">
            {projectId
              ? "Si une source DPGF est liee a cette affaire, vous pouvez pre-remplir automatiquement la version."
              : "Le pre-remplissage DPGF source est disponible depuis une affaire existante liee a un import DPGF."}
          </p>
          {projectId && isLoadingLinkedDpgfSource ? (
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Verification de la source DPGF liee...
            </p>
          ) : null}
          {projectId && linkedDpgfSourceError ? (
            <div className="alert alert-error mt-3 text-xs">{linkedDpgfSourceError}</div>
          ) : null}
          {projectId && hasLinkedDpgfSource ? (
            <p className="mt-2 text-xs text-[var(--slate-500)]">
              Source detectee: {linkedDpgfSource.filename} ({linkedDpgfSource.mappedRowCount} ligne(s) importable(s)).
            </p>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={
                data.dpgfImportMode === "none"
                  ? "btn btn-primary btn-sm justify-center"
                  : "btn btn-secondary btn-sm justify-center"
              }
              onClick={() => updateField("dpgfImportMode", "none")}
            >
              Je demarre sans DPGF
            </button>
            <button
              type="button"
              className={
                data.dpgfImportMode === "source"
                  ? "btn btn-primary btn-sm justify-center"
                  : `btn btn-secondary btn-sm justify-center ${
                      !hasLinkedDpgfSource || isLoadingLinkedDpgfSource
                        ? "cursor-not-allowed opacity-60"
                        : ""
                    }`
              }
              onClick={() => updateField("dpgfImportMode", "source")}
              disabled={!hasLinkedDpgfSource || isLoadingLinkedDpgfSource}
            >
              DPGF source a importer
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--slate-500)]">
            {data.dpgfImportMode === "source"
              ? "La version sera creee avec les lignes du DPGF source lie."
              : "Aucun pre-remplissage DPGF source a la creation."}
          </p>
        </div>

        {/* Summary */}
        <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--slate-700)]">
            Récapitulatif
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--slate-500)]">Projet</dt>
              <dd className="font-medium">
                {projectId ? "Projet existant" : data.projectName || "-"}
              </dd>
            </div>
            {data.clientName && (
              <div>
                <dt className="text-[var(--slate-500)]">Client</dt>
                <dd className="font-medium">{data.clientName}</dd>
              </div>
            )}
            <div>
              <dt className="text-[var(--slate-500)]">Date</dt>
              <dd className="font-medium">{formatDateLabel(data.dateDevis)}</dd>
            </div>
            <div>
              <dt className="text-[var(--slate-500)]">Marge</dt>
              <dd className="font-medium">
                {data.marginMode === "tiered"
                  ? "Par tranche"
                  : data.marginBp
                    ? `${(Number(data.marginBp) / 100).toFixed(1)}%`
                    : "Non définie"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--slate-500)]">TVA</dt>
              <dd className="font-medium">
                {Number(data.taxRateBp) > 0
                  ? `${(Number(data.taxRateBp) / 100).toFixed(1)}%`
                  : "Pas de TVA"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--slate-500)]">Mode</dt>
              <dd className="font-medium">
                {data.creationMode === "template"
                  ? "Depuis un modele"
                  : "Nouveau (vide)"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--slate-500)]">Famille de projet</dt>
              <dd className="font-medium">
                {data.projectFamily || "Non renseignee"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--slate-500)]">Import DPGF</dt>
              <dd className="font-medium">
                {data.dpgfImportMode === "source"
                  ? "Source DPGF a importer apres creation"
                  : "Aucun import au demarrage"}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  const isLastStep = currentStep === STEPS.length - 1;

  return (
    <div>
      <StepIndicator
        currentStep={currentStep}
        validatedSteps={validatedSteps}
        onStepClick={(step) => {
          setErrors({});
          setCurrentStep(step);
        }}
      />

      {submitError && (
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
          {submitError}
        </div>
      )}

      {errors._root && (
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
          {errors._root}
        </div>
      )}

      <div className="dashboard-card p-8">
        <h2 className="mb-1 text-lg font-semibold text-[var(--slate-800)]">
          {STEPS[currentStep].label}
        </h2>
        <p className="mb-6 text-sm text-[var(--slate-500)]">
          {STEPS[currentStep].description}
        </p>

        {currentStep === 0 && renderStep1()}
        {currentStep === 1 && renderStep2()}
        {currentStep === 2 && renderStep3()}

        {/* Navigation */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--slate-100)] pt-6">
          <div className="flex items-center gap-3">
            {currentStep > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={goBack}
                disabled={isSubmitting}
              >
                Retour
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Quick create — available on any step */}
            {!isLastStep && (
              <button
                type="button"
                className="btn btn-ghost text-sm"
                onClick={handleQuickCreate}
                disabled={isSubmitting}
                title="Créer directement avec les paramètres par défaut"
              >
                Créer directement
              </button>
            )}

            {isLastStep ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Création...
                  </>
                ) : (
                  "Créer le chiffrage"
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={goNext}
                disabled={isSubmitting}
              >
                Suivant
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
