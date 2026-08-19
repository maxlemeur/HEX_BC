import {
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
} from "@/lib/estimates/schemas";

import type {
  AffaireLinkedDpgfSource,
  EstimateTemplateSummary,
} from "@/lib/estimates/client";

import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";

export { DEFAULT_TAX_RATE_BP };
export const STORAGE_KEY = "est-wizard-draft";
export const DEFAULT_VALIDITE_JOURS = 30;

export const ROUNDING_OPTIONS = [
  { label: "Aucun", mode: "none" as const, step: 1 },
  { label: "1 EUR", mode: "nearest" as const, step: 100 },
  { label: "10 EUR", mode: "nearest" as const, step: 1000 },
  { label: "50 EUR", mode: "nearest" as const, step: 5000 },
  { label: "100 EUR", mode: "nearest" as const, step: 10000 },
] as const;

export const PROJECT_FAMILY_OPTIONS = [
  { value: "", label: "Non renseignee" },
  { value: "Maintenance", label: "Maintenance" },
  { value: "Renovation", label: "Renovation" },
  { value: "Travaux neufs", label: "Travaux neufs" },
  { value: "Mise en conformite", label: "Mise en conformite" },
  { value: "Rehabilitation", label: "Rehabilitation" },
] as const;

export const STEPS = [
  { label: "Projet", description: "Informations projet" },
  { label: "Paramètres", description: "Marge, TVA, arrondi" },
  { label: "Import", description: "Import optionnel" },
] as const;

export type WizardData = {
  projectName: string;
  clientName: string;
  reference: string;
  title: string;
  dateDevis: string;
  validiteJours: string;
  marginMode: "fixed" | "tiered";
  marginBp: string;
  taxRateBp: string;
  roundingMode: "none" | "nearest" | "up" | "down";
  roundingStepCents: string;
  currency: string;
  projectFamily: string;
  creationMode: "blank" | "template";
  selectedTemplateId: string;
  dpgfImportMode: "none" | "source";
};

export type StepErrors = Record<string, string>;

export type EstimateCreationResourcesState = {
  templates: EstimateTemplateSummary[];
  isLoadingTemplates: boolean;
  templatesError: string | null;
  linkedDpgfSource: AffaireLinkedDpgfSource;
  isLoadingLinkedDpgfSource: boolean;
  linkedDpgfSourceError: string | null;
  templateModeDisabled: boolean;
  templateModeUnavailable: boolean;
  hasLinkedDpgfSource: boolean;
};

export const FIELD_STEP_INDEX: Record<keyof WizardData, number> = {
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

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function initialWizardData(): WizardData {
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

export function normalizeStoredDraft(
  parsed: Record<string, unknown>
): Partial<WizardData> {
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
}

export function buildDpgfImportCreatePayload(
  mode: WizardData["dpgfImportMode"]
): { creationMode?: "linkedDpgfSource" } {
  if (mode !== "source") return {};
  return { creationMode: "linkedDpgfSource" };
}

export function hasImportableLinkedDpgfSource(
  source: AffaireLinkedDpgfSource
): source is NonNullable<AffaireLinkedDpgfSource> {
  return Boolean(
    source &&
      source.importStatus === "completed" &&
      source.mappedRowCount > 0
  );
}

export function buildProjectNotes(projectFamily: string) {
  const family = projectFamily.trim();
  if (!family) return null;
  return `Famille Achat: ${family}`;
}

export function formatDateLabel(isoValue: string) {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

export function parseZodErrors(error: unknown): StepErrors {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown[] }).issues)
  ) {
    const zodError = error as {
      issues: Array<{ path: (string | number)[]; message: string }>;
    };
    const errors: StepErrors = {};
    for (const issue of zodError.issues) {
      const key = String(issue.path[0] ?? "_root");
      if (!errors[key]) errors[key] = issue.message;
    }
    return errors;
  }
  return { _root: "Erreur de validation." };
}

export function getStepValidationErrors(
  step: number,
  data: WizardData,
  projectId?: string
): StepErrors | null {
  try {
    if (step === 0) {
      if (!projectId) {
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

    return null;
  } catch (error) {
    return parseZodErrors(error);
  }
}
