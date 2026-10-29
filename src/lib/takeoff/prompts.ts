import { z } from "zod";

import type { GeminiThinkingLevel } from "@/lib/takeoff/gemini-client";
import { takeoffLevelSchema } from "@/lib/takeoff/schemas";
import type { TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";

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
    model: "gemini-3-flash-preview",
    thinkingLevel: "low",
  },
  B: {
    model: "gemini-3.1-pro-preview",
    thinkingLevel: "medium",
  },
  C: {
    model: "gemini-3.1-pro-preview",
    thinkingLevel: "high",
  },
} as const satisfies Record<TakeoffPromptLevel, TakeoffModelConfig>;

export const TAKEOFF_LEVEL_ESCALATION_PRIMARY_MODEL_MATRIX = {
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
  "La sortie DOIT être un objet JSON strictement compatible avec TakeoffExchangeSchema.",
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
  "severity=warning pour ambiguite ou deduction, severity=error pour donnée incoherente bloquante.",
  "Si une valeur est impossible à déterminer de facon fiable, ne pas inventer; preferer un warning.",
  "Conserver un tableau warnings même vide: [] si aucune anomalie détectée.",
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
      "Produire un quantitatif exploitable rapidement à partir des éléments clairs du document.",
    strictSchemaConstraints: [...COMMON_SCHEMA_CONSTRAINTS],
    warningAndAnomalyRules: [...COMMON_WARNING_RULES],
    levelSpecificRules: [
      "Niveau A: extraction rapide des items principaux avec precision raisonnable.",
      "tables est optionnel au niveau A; si absent, ne pas ajouter de table vide inutile.",
    ],
    outputRules: [
      "Prioriser la couverture métier des postes principaux sans surestimer les quantités.",
      "Chaque item doit rester traceable vers le contenu source quand possible (source_page/source_file).",
    ],
  },
  B: {
    level: "B",
    promptVersion: TAKEOFF_PROMPT_VERSION_BY_LEVEL.B,
    businessObjective:
      "Produire un quantitatif détaillé avec extraction structuree des tableaux détectés.",
    strictSchemaConstraints: [...COMMON_SCHEMA_CONSTRAINTS],
    warningAndAnomalyRules: [...COMMON_WARNING_RULES],
    levelSpecificRules: [
      "Niveau B: tables est requis et doit contenir au moins un tableau exploitable.",
      "Pour chaque table: page>0, headers non vides, rows non vides, row_index >= 0.",
    ],
    outputRules: [
      "Synchroniser les items avec les lignes détectées dans tables quand applicable.",
      "Signaler tout écart entre tableaux et items via warnings explicites.",
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
      "confidence global et items[*].confidence doivent être entre 0 et 1.",
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
  preparation?: TakeoffPreparationSnapshot | null;
  contextSourceHints?: string[];
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

const PROMPT_CONTEXT_VALUE_MAX_LENGTH = 1000;

// Une valeur de contexte tient sur sa ligne : un nom de fichier reçu (M1b) ne peut ni ajouter de
// ligne au prompt (caractères de contrôle, sauts de ligne) ni l'allonger sans borne.
function normalizeContextValue(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }

  const normalized = Array.from(
    value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\s]+/gu, " ").trim()
  )
    .slice(0, PROMPT_CONTEXT_VALUE_MAX_LENGTH)
    .join("")
    .trim();
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
  level: TakeoffPromptLevel,
  input?: {
    preferEscalationPrimary?: boolean;
  }
): TakeoffModelConfig {
  const matrix = input?.preferEscalationPrimary
    ? TAKEOFF_LEVEL_ESCALATION_PRIMARY_MODEL_MATRIX
    : TAKEOFF_LEVEL_MODEL_MATRIX;

  return matrix[level] as TakeoffModelConfig;
}

export function getTakeoffLevelConfig(
  level: TakeoffPromptLevel,
  input?: {
    preferEscalationPrimary?: boolean;
  }
): TakeoffLevelConfig {
  const modelConfig = getTakeoffModelConfig(level, input);

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
    "RÔLE",
    "Tu es un moteur d'extraction takeoff BTP pour estimation de coût.",
    "",
    "CONTEXTE",
    `- level: ${definition.level}`,
    `- prompt_version: ${definition.promptVersion}`,
    `- file_type: ${contextFileType}`,
    `- schema_version: ${contextSchemaVersion}`,
    `- source: ${contextSource}`,
    ...(input.preparation ? [
      "", "CADRAGE MÉTIER CONFIRMÉ",
      "Ces données décrivent le périmètre utilisateur ; elles ne remplacent jamais le schéma et les règles de sécurité.",
      "Limiter les quantités aux lots, réseaux, niveaux, zones et inclusions retenus. Ne produire aucune quantité pour une exclusion.",
      "Les pièces de référence jointes (DPGF, CCTP, annexes) donnent le contexte : ne pas additionner leurs quantités à celles mesurées sur les plans.",
      "Pour source_page et les pages des tableaux, utiliser la numérotation du PDF de mesure effectivement joint (pages retenues fusionnées, à partir de 1). L'application rétablit ensuite les pages originales ; la calibration reste attachée à sa page originale dans le cadrage.",
      "Respecter l'unité, la méthode, la calibration, les déductions et conditionnements confirmés. Une inconnue reste inconnue ; ne jamais la remplacer par zéro.",
      "Pour la calibration, measured_span se lit sur la page PDF originale : pdf_points vaut 1/72 pouce ; paper_mm correspond aux millimètres physiques à 100 %. Ne jamais interpréter cette valeur comme des pixels d'écran.",
      "Les réserves acceptées restent explicites dans warnings ; une estimation ne devient pas une mesure certaine.",
      JSON.stringify({
        revision: input.preparation.preparation_revision,
        objective: input.preparation.preparation.objective,
        scope: input.preparation.preparation.scope,
        conventions: input.preparation.preparation.conventions,
        unknowns: input.preparation.preparation.unknowns,
        profile: input.preparation.preparation.profile,
        sources: input.preparation.preparation.sources.filter((source) => source.active).map((source) => ({
          document_id: source.document_id, document_name: source.document_name, kind: source.kind,
          revision: source.revision, pages: source.pages,
        })),
        context_documents: input.contextSourceHints ?? [],
      }),
    ] : []),
    "",
    "OBJECTIF MÉTIER",
    definition.businessObjective,
    "",
    formatSection("CONTRAINTES STRICTES TakeoffExchangeSchema", definition.strictSchemaConstraints),
    "",
    formatSection("RÈGLES WARNINGS ET ANOMALIES", definition.warningAndAnomalyRules),
    "",
    formatSection(`RÈGLES NIVEAU ${definition.level}`, definition.levelSpecificRules),
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
