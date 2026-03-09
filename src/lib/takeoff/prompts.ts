import { z } from "zod";

import type { GeminiThinkingLevel } from "@/lib/takeoff/gemini-client";
import { takeoffLevelSchema } from "@/lib/takeoff/schemas";

export type TakeoffPromptLevel = z.infer<typeof takeoffLevelSchema>;

export const TAKEOFF_PROMPT_VERSION_BY_LEVEL = {
  A: "takeoff-a-v1",
  B: "takeoff-b-v1",
  C: "takeoff-c-v1",
} as const satisfies Record<TakeoffPromptLevel, string>;

export type TakeoffPromptVersion =
  (typeof TAKEOFF_PROMPT_VERSION_BY_LEVEL)[TakeoffPromptLevel];

export type TakeoffModelConfig = {
  model: string;
  thinkingLevel: GeminiThinkingLevel;
};

export type TakeoffEscalationModelConfig = TakeoffModelConfig & {
  reason: string;
};

export const TAKEOFF_LEVEL_MODEL_MATRIX = {
  A: {
    model: "gemini-3.1-flash-lite-preview",
    thinkingLevel: "low",
  },
  B: {
    model: "gemini-3-flash-preview",
    thinkingLevel: "medium",
  },
  C: {
    model: "gemini-3.1-pro-preview",
    thinkingLevel: "high",
  },
} as const satisfies Record<TakeoffPromptLevel, TakeoffModelConfig>;

export const TAKEOFF_LEVEL_ESCALATION_MODEL_MATRIX = {
  A: {
    model: "gemini-3-flash-preview",
    thinkingLevel: "low",
    reason: "Fallback when Flash-Lite produces invalid structured output.",
  },
  B: {
    model: "gemini-3.1-pro-preview",
    thinkingLevel: "medium",
    reason: "Fallback when Flash extraction is ambiguous or structurally weak.",
  },
  C: null,
} as const satisfies Record<
  TakeoffPromptLevel,
  TakeoffEscalationModelConfig | null
>;

const COMMON_SCHEMA_CONSTRAINTS = [
  "La sortie DOIT etre un objet JSON strictement compatible avec TakeoffExchangeSchema.",
  "Racine obligatoire: items (array), warnings (array), metadata (objet).",
  "metadata obligatoire: level, prompt_version, file_type, schema_version.",
  "Toujours renseigner metadata.level avec le niveau demande sans deviation.",
  "Toujours renseigner metadata.prompt_version avec la version attendue pour le niveau.",
  "Interdiction d'ajouter des champs hors schema; aucun champ inconnu n'est autorise.",
  "items[*] obligatoire: designation (string), quantity (>0), unit (string).",
  "warnings[*] doit respecter code/message/severity, avec severity dans info|warning|error.",
  "Renvoyer du JSON pur uniquement, sans markdown, sans commentaire, sans texte hors JSON.",
] as const;

const COMMON_WARNING_RULES = [
  "Chaque incertitude doit produire un warning explicite avec un code stable en MAJUSCULES.",
  "Utiliser item_index et table_index quand la source de l'anomalie est connue.",
  "severity=warning pour ambiguite ou deduction, severity=error pour donnee incoherente bloquante.",
  "Si une valeur est impossible a determiner de facon fiable, ne pas inventer; preferer un warning.",
  "Conserver un tableau warnings meme vide: [] si aucune anomalie detectee.",
] as const;

export interface TakeoffPromptDefinition<TLevel extends TakeoffPromptLevel = TakeoffPromptLevel> {
  level: TLevel;
  promptVersion: (typeof TAKEOFF_PROMPT_VERSION_BY_LEVEL)[TLevel];
  businessObjective: string;
  strictSchemaConstraints: readonly string[];
  warningAndAnomalyRules: readonly string[];
  levelSpecificRules: readonly string[];
  outputRules: readonly string[];
}

const TAKEOFF_PROMPT_DEFINITIONS = {
  A: {
    level: "A",
    promptVersion: TAKEOFF_PROMPT_VERSION_BY_LEVEL.A,
    businessObjective:
      "Produire un quantitatif exploitable rapidement a partir des elements clairs du document.",
    strictSchemaConstraints: [...COMMON_SCHEMA_CONSTRAINTS],
    warningAndAnomalyRules: [...COMMON_WARNING_RULES],
    levelSpecificRules: [
      "Niveau A: extraction rapide des items principaux avec precision raisonnable.",
      "tables est optionnel au niveau A; si absent, ne pas ajouter de table vide inutile.",
    ],
    outputRules: [
      "Prioriser la couverture metier des postes principaux sans surestimer les quantites.",
      "Chaque item doit rester traceable vers le contenu source quand possible (source_page/source_file).",
    ],
  },
  B: {
    level: "B",
    promptVersion: TAKEOFF_PROMPT_VERSION_BY_LEVEL.B,
    businessObjective:
      "Produire un quantitatif detaille avec extraction structuree des tableaux detectes.",
    strictSchemaConstraints: [...COMMON_SCHEMA_CONSTRAINTS],
    warningAndAnomalyRules: [...COMMON_WARNING_RULES],
    levelSpecificRules: [
      "Niveau B: tables est requis et doit contenir au moins un tableau exploitable.",
      "Pour chaque table: page>0, headers non vides, rows non vides, row_index >= 0.",
    ],
    outputRules: [
      "Synchroniser les items avec les lignes detectees dans tables quand applicable.",
      "Signaler tout ecart entre tableaux et items via warnings explicites.",
    ],
  },
  C: {
    level: "C",
    promptVersion: TAKEOFF_PROMPT_VERSION_BY_LEVEL.C,
    businessObjective:
      "Produire un quantitatif auditable avec indicateurs de confiance et preuves par item.",
    strictSchemaConstraints: [...COMMON_SCHEMA_CONSTRAINTS],
    warningAndAnomalyRules: [...COMMON_WARNING_RULES],
    levelSpecificRules: [
      "Niveau C: confidence global est requis pour le niveau C.",
      "Niveau C: items[*].confidence est requis pour chaque item au niveau C.",
      "Niveau C: source_page est requis pour chaque item au niveau C.",
      "Niveau C: evidence est requis pour chaque item au niveau C.",
      "confidence global et items[*].confidence doivent etre entre 0 et 1.",
      "Chaque evidence doit decrire la source de preuve de facon concise et verifiable.",
    ],
    outputRules: [
      "Maximiser la tracabilite: justifier les dedutions avec evidence et warnings associes.",
      "En cas de doute fort, reduire confidence et expliquer l'anomalie dans warnings.",
    ],
  },
} as const satisfies {
  [K in TakeoffPromptLevel]: TakeoffPromptDefinition<K>;
};

export type TakeoffPromptBuildInput = {
  fileType?: string;
  schemaVersion?: string;
  sourceHint?: string;
};

export type TakeoffLevelConfig = {
  level: TakeoffPromptLevel;
  promptVersion: TakeoffPromptVersion;
  model: string;
  thinkingLevel: GeminiThinkingLevel;
};

export type TakeoffPromptRuntimeConfig = TakeoffLevelConfig & {
  prompt: string;
};

function normalizeContextValue(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function formatSection(title: string, lines: readonly string[]) {
  return [title, ...lines.map((line, index) => `${index + 1}. ${line}`)].join("\n");
}

export function getTakeoffPromptVersion(
  level: TakeoffPromptLevel
): TakeoffPromptVersion {
  return TAKEOFF_PROMPT_VERSION_BY_LEVEL[level];
}

export function getTakeoffModelConfig(
  level: TakeoffPromptLevel
): TakeoffModelConfig {
  return TAKEOFF_LEVEL_MODEL_MATRIX[level] as TakeoffModelConfig;
}

export function getTakeoffLevelConfig(
  level: TakeoffPromptLevel
): TakeoffLevelConfig {
  const modelConfig = getTakeoffModelConfig(level);

  return {
    level,
    promptVersion: getTakeoffPromptVersion(level),
    model: modelConfig.model,
    thinkingLevel: modelConfig.thinkingLevel,
  };
}

export function getTakeoffEscalationModelConfig(
  level: TakeoffPromptLevel
): TakeoffEscalationModelConfig | null {
  return TAKEOFF_LEVEL_ESCALATION_MODEL_MATRIX[level];
}

export function getTakeoffPromptDefinition(
  level: TakeoffPromptLevel
): TakeoffPromptDefinition {
  return TAKEOFF_PROMPT_DEFINITIONS[level] as TakeoffPromptDefinition;
}

export function getTakeoffPrompt(
  level: TakeoffPromptLevel,
  input: TakeoffPromptBuildInput = {}
): string {
  const definition = getTakeoffPromptDefinition(level);
  const contextFileType = normalizeContextValue(input.fileType, "unknown");
  const contextSchemaVersion = normalizeContextValue(input.schemaVersion, "v1");
  const contextSource = normalizeContextValue(input.sourceHint, "upload");

  return [
    "ROLE",
    "Tu es un moteur d'extraction takeoff BTP pour estimation de cout.",
    "",
    "CONTEXTE",
    `- level: ${definition.level}`,
    `- prompt_version: ${definition.promptVersion}`,
    `- file_type: ${contextFileType}`,
    `- schema_version: ${contextSchemaVersion}`,
    `- source: ${contextSource}`,
    "",
    "OBJECTIF METIER",
    definition.businessObjective,
    "",
    formatSection("CONTRAINTES STRICTES TakeoffExchangeSchema", definition.strictSchemaConstraints),
    "",
    formatSection("REGLES WARNINGS ET ANOMALIES", definition.warningAndAnomalyRules),
    "",
    formatSection(`REGLES NIVEAU ${definition.level}`, definition.levelSpecificRules),
    "",
    formatSection("CONSIGNES DE SORTIE", definition.outputRules),
    "",
    "FINAL",
    "Retourne exclusivement un JSON valide conforme au schema, sans texte additionnel.",
  ].join("\n");
}

export function getTakeoffPromptRuntimeConfig(
  level: TakeoffPromptLevel,
  input: TakeoffPromptBuildInput = {}
): TakeoffPromptRuntimeConfig {
  return {
    ...getTakeoffLevelConfig(level),
    prompt: getTakeoffPrompt(level, input),
  };
}
