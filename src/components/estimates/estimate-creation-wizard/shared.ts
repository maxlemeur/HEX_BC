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
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import {
  formatEstimateV3Coefficient,
  isValidEstimateV3SaleCoefficient,
} from "@/lib/estimates/v3-settings-payload";
import { parseCoefficient } from "@/lib/numeric-input/parsers";

export { DEFAULT_TAX_RATE_BP };
export const STORAGE_KEY = "est-wizard-draft";
export const DEFAULT_VALIDITE_JOURS = 30;

/**
 * Lot 2, sous-lot 2.10a (N1, A4) : moteur des nouvelles versions de l'entreprise et coefficients de vente par
 * défaut, lus côté serveur par la page de l'assistant (`readTenantCalcPolicy`). Chaque création de l'assistant
 * envoie ce moteur comme attente ; la création relit la politique sous verrou (D3).
 */
export type EstimateCreationEngine = {
  engine: 2 | 3;
  saleCoefficientFo: number | null;
  saleCoefficientMo: number | null;
};

/**
 * Moteur 2 historique : défaut d'un assistant monté sans page serveur (tests de composants). La page de l'assistant
 * lit la politique de l'entreprise ; depuis la bascule (2.10b, M8), une politique absente y vaut le moteur 3.
 */
export const HISTORICAL_CREATION_ENGINE: EstimateCreationEngine = {
  engine: 2,
  saleCoefficientFo: null,
  saleCoefficientMo: null,
};

/** Moteur 3 : arrondi « aucun » ou inférieur seulement (D7) ; un autre mode restauré d'un brouillon vaut « aucun ». */
export function resolveWizardV3Rounding(data: Pick<WizardData, "roundingMode" | "roundingStepCents">) {
  return data.roundingMode === "down"
    ? { mode: "down" as const, step: Number(data.roundingStepCents) }
    : { mode: "none" as const, step: 1 };
}

/** Coefficient de vente saisi (virgule décimale, 4 décimales au plus) dans ]0 ; 10], sinon `null`. */
export function parseWizardSaleCoefficient(text: string): number | null {
  const value = parseCoefficient(text);
  return isValidEstimateV3SaleCoefficient(value) ? value : null;
}

function formatDefaultSaleCoefficient(value: number | null) {
  return value === null ? "" : formatEstimateV3Coefficient(value);
}

export const PROJECT_FAMILY_OPTIONS = [
  { value: "", label: "Non renseignée" },
  { value: "Maintenance", label: "Maintenance" },
  { value: "Renovation", label: "Rénovation" },
  { value: "Travaux neufs", label: "Travaux neufs" },
  { value: "Mise en conformite", label: "Mise en conformité" },
  { value: "Rehabilitation", label: "Réhabilitation" },
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
  // Moteur 3 seulement (2.10a, A4) : texte saisi, comme les réglages de l'éditeur v3.
  saleCoefficientFo: string;
  saleCoefficientMo: string;
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
  saleCoefficientFo: 1,
  saleCoefficientMo: 1,
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

export function initialWizardData(
  creationEngine: EstimateCreationEngine = HISTORICAL_CREATION_ENGINE
): WizardData {
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
    saleCoefficientFo: formatDefaultSaleCoefficient(creationEngine.saleCoefficientFo),
    saleCoefficientMo: formatDefaultSaleCoefficient(creationEngine.saleCoefficientMo),
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

const SALE_COEFFICIENT_FIELDS = [
  ["saleCoefficientFo", "FO"],
  ["saleCoefficientMo", "MO"],
] as const;

/** Moteur 3 (2.10a, A4) : coefficients de vente FO et MO, mêmes bornes que les réglages de l'éditeur v3. */
function getV3PricingErrors(data: WizardData): StepErrors | null {
  const errors: StepErrors = {};
  for (const [field, label] of SALE_COEFFICIENT_FIELDS) {
    if (parseWizardSaleCoefficient(data[field]) === null) {
      errors[field] = `Coefficient de vente ${label} invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus.`;
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export function getStepValidationErrors(
  step: number,
  data: WizardData,
  projectId?: string,
  creationEngine: EstimateCreationEngine = HISTORICAL_CREATION_ENGINE
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
    } else if (step === 1 && usesSaleCoefficients(creationEngine.engine)) {
      const rounding = resolveWizardV3Rounding(data);
      wizardStep2Schema.parse({
        dateDevis: data.dateDevis,
        validiteJours: Number(data.validiteJours),
        marginMode: "fixed",
        taxRateBp: Number(data.taxRateBp),
        roundingMode: rounding.mode,
        roundingStepCents: rounding.mode === "down" ? rounding.step : undefined,
        currency: data.currency || undefined,
      });
      return getV3PricingErrors(data);
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
