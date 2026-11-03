import { getTakeoffPrompt, getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import { DECISIONS_INSTRUCTIONS_MAX, EXTRACTION_PROMPT_MAX, type LabTaskDescriptor } from "@/lib/takeoff/lab/contracts";

// Task registry of the takeoff lab (TI-661). One task per essai. Adding a task
// is one entry here: an extraction (TakeoffExchangeSchema on ChatGPT) or a
// generic « choice » question with fixed options (2 to 255, unique), answered
// by Decisions (gpt-6-luna, with a probability per option) or by a ChatGPT
// model asked for the same choice. The page sort of TI-663 and the layer class
// of TI-662 are choice tasks added after this one, each in its own change.
// The editable prompt is the extraction prompt, or the question's instructions
// (8 000 characters at most, Decisions' limit).

export type LabTask = LabTaskDescriptor & {
  /** Choice tasks: the JSON context sent to Decisions beside the rendered image (256 Kio at most). */
  evidence?: (input: { documentId: string; pages: number; page: number; region: boolean }) => Record<string, unknown>;
};

/** Fixed source hint: the same prompt on two documents keeps one prompt version. */
const EXTRACTION_SOURCE_HINT = "labo-metre";

const extraction: LabTask = {
  id: "extraction-niveau-c",
  kind: "extraction",
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

export const LAB_TASKS: readonly LabTask[] = [extraction, planDiscipline];

export function findLabTask(id: string) {
  return LAB_TASKS.find((task) => task.id === id) ?? null;
}

/** What the screens receive: no server-side builder. */
export function describeLabTasks(): LabTaskDescriptor[] {
  return LAB_TASKS.map((task) => ({
    id: task.id, kind: task.kind, label: task.label, description: task.description, providers: task.providers,
    defaultPrompt: task.defaultPrompt, promptBase: task.promptBase, promptMax: task.promptMax, question: task.question,
  }));
}
