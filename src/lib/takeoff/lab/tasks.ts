import { NETWORK_CODES, NETWORKS } from "@/lib/takeoff/bench/keys";
import { getTakeoffPrompt, getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { DECISIONS_INSTRUCTIONS_MAX, EXTRACTION_PROMPT_MAX, LAB_VECTOR_TASK_ID, type LabTaskDescriptor } from "@/lib/takeoff/lab/contracts";
import {
  GROUP_DECISIONS_DEVELOPER, GROUP_DECISIONS_LIMITS, GROUP_DECISIONS_PROMPT_VERSION, GROUP_DECISIONS_VERSION, groupQuestionText,
} from "@/lib/takeoff/vectors/group-decisions";
import { groupAnswerChoices } from "@/lib/takeoff/vectors/group-evidence";
import { OTHER_CLASSES } from "@/lib/takeoff/vectors/vocabulary";

// Task registry of the takeoff lab (TI-661). One task per essai. Adding a task
// is one entry here: an extraction (TakeoffExchangeSchema on ChatGPT) or a
// generic « choice » question with fixed options (2 to 255, unique), answered
// by Decisions (gpt-6-luna, with a probability per option) or by a ChatGPT
// model asked for the same choice. The page sort of TI-663 is a choice task
// added in its own change.
// The editable prompt is the extraction prompt, or the question's instructions
// (8 000 characters at most, Decisions' limit).
// « Classe de calque » (TI-662 L3c) is launched from the vectors page: one
// Decisions run of group-decisions-server.ts classifyVectorGroups on a page
// (one choice question per group the keywords leave, in batches, with
// server-rendered images), not one question on a browser image. Its questions
// are those of group-decisions.ts, never edited here: its prompt version
// hashes their template (instructions and choices, alias « groupe_NN »), so
// two documents keep one version.

export type LabTask = LabTaskDescriptor & {
  /** Choice tasks: the JSON context sent to Decisions beside the rendered image (256 Kio at most). */
  evidence?: (input: { documentId: string; pages: number; page: number; region: boolean }) => Record<string, unknown>;
};

/** Fixed source hint: the same prompt on two documents keeps one prompt version. */
const EXTRACTION_SOURCE_HINT = "labo-metre";

const extraction: LabTask = {
  id: "extraction-niveau-c",
  kind: "extraction",
  screen: "essai",
  label: "Extraction ChatGPT (niveau C)",
  description: "Quantités d’un plan PDF lues par ChatGPT avec le prompt et le schéma du métré (niveau C).",
  providers: ["chatgpt"],
  defaultPrompt: getTakeoffPrompt("C", { fileType: "application/pdf", schemaVersion: "v1", sourceHint: EXTRACTION_SOURCE_HINT }),
  promptBase: getTakeoffPromptVersion("C"),
  promptMax: EXTRACTION_PROMPT_MAX,
  question: null,
};

const planDiscipline: LabTask = {
  id: "lot-technique",
  kind: "choice",
  screen: "essai",
  label: "Lot technique du plan (question choice)",
  description: "Une question choice : quel lot technique la page dessine-t-elle ? Decisions donne une probabilité par option.",
  providers: ["decisions", "chatgpt"],
  defaultPrompt: [
    "Indique le lot technique que dessine principalement cette page de plan.",
    "Plomberie : eau froide, eau chaude, évacuations, appareils sanitaires.",
    "CVC hydraulique : eau glacée, chauffage, vannes et calorifuge des réseaux d’eau.",
    "CVC aéraulique : gaines, bouches, boîtes de ventilation.",
    "Tuyauterie industrielle : process, inox, modules répétés.",
    "Architecture : cloisons, pièces et surfaces, sans réseau dessiné.",
    "Appuie-toi sur la légende, le cartouche et les tracés visibles ; réponds « autre » si aucun lot ne domine.",
  ].join("\n"),
  promptBase: null,
  promptMax: DECISIONS_INSTRUCTIONS_MAX,
  question: {
    name: "lot_technique",
    label: "Lot technique",
    choices: [
      { value: "plomberie", label: "Plomberie" },
      { value: "cvc_hydraulique", label: "CVC hydraulique" },
      { value: "cvc_aeraulique", label: "CVC aéraulique" },
      { value: "tuyauterie_industrielle", label: "Tuyauterie industrielle" },
      { value: "architecture", label: "Architecture" },
      { value: "autre", label: "Autre" },
    ],
  },
  evidence: ({ documentId, pages, page, region }) => ({
    tache: "lot technique du plan",
    document: { id: documentId, pages, page_montree: page, zone_recadree: region },
  }),
};

const OTHER_CLASS_LABELS: Record<(typeof OTHER_CLASSES)[number], string> = {
  mur: "Mur", cloison: "Cloison", fond: "Fond de plan", cotation: "Cotation", texte: "Texte", autre: "Autre",
};

/**
 * The fixed words of the « classe de calque » questions (group-decisions.ts, under the alias « groupe_NN »): the
 * developer message, a group's question and the answers of a page without plan codes; the identity of its prompt.
 */
export function vectorGroupsQuestionTemplate() {
  return {
    prompt_version: GROUP_DECISIONS_PROMPT_VERSION, rules_version: GROUP_DECISIONS_VERSION,
    developer: GROUP_DECISIONS_DEVELOPER, question: groupQuestionText("groupe_NN"),
    choices: groupAnswerChoices({ plan_codes: [], legend_blocks: [] }).map((choice) => choice.value),
  };
}

const vectorGroupClass: LabTask = {
  id: LAB_VECTOR_TASK_ID,
  kind: "choice",
  screen: "vectors",
  label: "Classe de calque (groupes de tracés)",
  description: "Les règles puis Decisions classent chaque groupe de tracés d’une page que les mots-clés laissent sans classe : réseau, fond, texte ou autre.",
  providers: ["decisions"],
  defaultPrompt: [
    `Questions fixées par la lecture vectorielle (${GROUP_DECISIONS_PROMPT_VERSION}), non modifiables dans le labo.`,
    "Les règles classent d’abord : même couleur qu’un réseau classé, bande le long d’un réseau. Les autres groupes sont demandés à Decisions,"
      + ` une question choice chacun, ${GROUP_DECISIONS_LIMITS.batchSize} par appel, chacun avec son image (tronçon, tronçon pâli, environs, page)`
      + " et sa preuve JSON, la légende rendue avec ses textes en tête. Un même coloris se propage ensuite.",
    "Les groupes qui ne peuvent être un réseau (gris, motif, calque de cadre ou d’architecture, échantillon de légende, couleur de gaine d’air)"
      + " ne sont pas envoyés. Question d’un groupe :",
    vectorGroupsQuestionTemplate().question,
  ].join("\n"),
  promptBase: GROUP_DECISIONS_PROMPT_VERSION,
  promptMax: DECISIONS_INSTRUCTIONS_MAX,
  question: {
    name: "classe_de_calque",
    label: "Classe de calque",
    choices: [
      ...NETWORK_CODES.map((value) => ({ value, label: value, description: NETWORKS[value].label })),
      ...OTHER_CLASSES.map((value) => ({ value, label: OTHER_CLASS_LABELS[value] })),
    ],
  },
};

export const LAB_TASKS: readonly LabTask[] = [extraction, planDiscipline, vectorGroupClass];

export function findLabTask(id: string) {
  return LAB_TASKS.find((task) => task.id === id) ?? null;
}

/** What the screens receive: no server-side builder. */
export function describeLabTasks(): LabTaskDescriptor[] {
  return LAB_TASKS.map((task) => ({
    id: task.id, kind: task.kind, screen: task.screen, label: task.label, description: task.description, providers: task.providers,
    defaultPrompt: task.defaultPrompt, promptBase: task.promptBase, promptMax: task.promptMax, question: task.question,
  }));
}
