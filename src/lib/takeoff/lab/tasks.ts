import { NETWORK_CODES, NETWORKS } from "@/lib/takeoff/bench/keys";
import { getTakeoffPrompt, getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { DECISIONS_INSTRUCTIONS_MAX, EXTRACTION_PROMPT_MAX, LAB_VECTOR_TASK_ID, type LabTaskDescriptor } from "@/lib/takeoff/lab/contracts";
import { GROUP_DECISIONS_LIMITS, GROUP_DECISIONS_PROMPT_VERSION, GROUP_DECISIONS_VERSION, groupQuestions } from "@/lib/takeoff/vectors/group-decisions";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
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
 * The questions of group-decisions.ts for an ordinary and a grey group, in a batch and alone, under the alias
 * « groupe_NN »: the identity of the « classe de calque » prompt. groupQuestions only reads each group's grey flag.
 */
export function vectorGroupsQuestionTemplate() {
  const model = { groups: [{ grey: false }, { grey: true }] } as unknown as PageModel;
  const candidates = [0, 1].map((group) => ({ alias: "groupe_NN", group, id: `template-${group}`, visibleLength_pt: 0, share: 0 }));
  return {
    prompt_version: GROUP_DECISIONS_PROMPT_VERSION, rules_version: GROUP_DECISIONS_VERSION,
    batch: groupQuestions(model, candidates, "batch"), dedicated: groupQuestions(model, candidates, "dedicated"),
  };
}

const vectorGroupClass: LabTask = {
  id: LAB_VECTOR_TASK_ID,
  kind: "choice",
  screen: "vectors",
  label: "Classe de calque (groupes de tracés)",
  description: "Decisions classe chaque groupe de tracés d’une page que les mots-clés laissent sans classe : réseau, mur, cloison, fond, cotation, texte ou autre.",
  providers: ["decisions"],
  defaultPrompt: [
    `Questions fixées par la lecture vectorielle (${GROUP_DECISIONS_PROMPT_VERSION}), non modifiables dans le labo.`,
    `Une question choice par groupe de tracés sans classe par mots-clés, par lots de ${GROUP_DECISIONS_LIMITS.batchSize} groupes avec la légende`
      + ` (ou la page en vignette) et une planche de vignettes, puis seul avec son rendu pour une réponse sous ${GROUP_DECISIONS_LIMITS.dedicatedBelow}.`,
    "Les groupes qui ne peuvent être un réseau (gris, motif, calque de cadre ou d’architecture, échantillon de légende, couleur de gaine d’air)"
      + " ne sont pas envoyés. Question d’un groupe :",
    vectorGroupsQuestionTemplate().batch[0].instructions,
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
