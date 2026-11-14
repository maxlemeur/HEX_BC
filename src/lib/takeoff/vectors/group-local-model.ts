import { z } from "zod";

import { NETWORK_CODES, NETWORKS, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { GROUP_DECISIONS_DEVELOPER } from "@/lib/takeoff/vectors/group-decisions";
import { groupJson, OTHER_ANSWERS, type CandidateEvidence, type PageEvidence } from "@/lib/takeoff/vectors/group-evidence";
import { classOfAnswer, horsListeProposal, paleGuardDrops } from "@/lib/takeoff/vectors/group-rules";
import type { VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// The vector groups read by a reasoning model through the local ChatGPT plan
// (TI-704 option B of 12/11/2026, local mode only), pure: the request of a
// batch of groups and how its answer is read. The calls are in
// group-local-model-server.ts.
// - Every candidate is asked (the rules of option A are hints in its JSON,
//   never a decision: the band before the model lost the direction, 32 → 21
//   exact), 8 groups per request, the legend blocks' images first, then each
//   group's 2 × 2 image in full definition, in the order of the list.
// - The model writes its class and its probability; a network is accepted from
//   LOCAL_MODEL_ACCEPTED_PROBABILITY (0.8). « inconnu » and « hors_liste » give
//   no class (« hors_liste » with its proposal); the pale guard as for
//   Decisions.
// - The answer is read group by group: one malformed entry makes only its
//   group « invalid », never the request (readLocalModelEntries).
// Measured on the 8 development plans (gpt-6.1-sol, effort low): 32 of the 36
// networks exact, none false, in the experiment of 12/11; 30 to 32 exact, none
// false, 7 to 9 of the 61 candidates « à revoir », over two identical runs of
// the product's bench on 13/11 (the plan's answers vary a little).

export const GROUP_LOCAL_MODEL_PROMPT_VERSION = "takeoff-vector-groups-v2-local";
export const GROUP_LOCAL_MODEL = { model: "gpt-6.1-sol", reasoningEffort: "low" as const, groupsPerRequest: 8, timeoutMs: 180_000 } as const;
/**
 * Requests of the local plan per document and run (the worker, and the bench alike): 320 groups, ten of the heaviest
 * pages measured (26 candidates, 4 requests); per page, 25 (200 groups, as Decisions' 10 calls of 20), which bounds the
 * images of one drawing. Past them the groups follow the rules; the plan's quota stops it earlier.
 */
export const GROUP_LOCAL_MODEL_LIMITS = { requestsPerDocument: 40, requestsPerPage: 25 } as const;

export const groupLocalModelSchema = z.object({
  groupes: z.array(z.object({
    groupe: z.string(), classe: z.string(), probabilite: z.number().min(0).max(1),
    classe_suivante: z.string().nullable().optional(), probabilite_suivante: z.number().min(0).max(1).nullable().optional(),
  })),
});
export type GroupLocalModelAnswer = z.infer<typeof groupLocalModelSchema>;
/** A request's answer as read: per entry its group, its class and its probability (null when it is not a number in [0, 1]). */
export type LocalModelEntries = { groupes: Array<{ groupe: string; classe: string; probabilite: number | null }> };

/** The entries of an answer that passed the schema. */
export function localModelEntries(answer: GroupLocalModelAnswer): LocalModelEntries {
  return { groupes: answer.groupes.map((entry) => ({ groupe: entry.groupe, classe: entry.classe, probabilite: entry.probabilite })) };
}

/**
 * The entries of an answer the schema refused, read group by group: an entry that is not an object or names no group
 * is dropped, a class that is not a string is empty, a probability that is not a number in [0, 1] is null (its group
 * « invalid »). Null when the answer has no list of groups.
 */
export function readLocalModelEntries(value: unknown): LocalModelEntries | null {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { groupes?: unknown }).groupes)) return null;
  const groupes: LocalModelEntries["groupes"] = [];
  for (const entry of (value as { groupes: unknown[] }).groupes) {
    if (typeof entry !== "object" || entry === null) continue;
    const { groupe, classe, probabilite } = entry as Record<string, unknown>;
    if (typeof groupe !== "string") continue;
    groupes.push({ groupe, classe: typeof classe === "string" ? classe : "",
      probabilite: typeof probabilite === "number" && Number.isFinite(probabilite) && probabilite >= 0 && probabilite <= 1 ? probabilite : null });
  }
  return { groupes };
}

/** The answers offered, with the plan's codes and legend rows that lead to each network (measured wording). */
export function localModelChoices(evidence: Pick<PageEvidence, "plan_codes" | "legend_blocks">) {
  return [
    ...NETWORK_CODES.map((code) => {
      const codes = evidence.plan_codes.filter((entry) => entry.class === code).map((entry) => `${entry.code} (${entry.count} libellés)`);
      const rows = evidence.legend_blocks.flatMap((block) => block.rows.filter((row) => row.samples.some((sample) => sample.keywordClass === code))
        .map((row) => `« ${row.texts.join(" ")} »`));
      const extra = [codes.length ? `sur ce plan : ${codes.join(", ")}` : "", rows.length ? `légende : ${rows.slice(0, 3).join(", ")}` : ""].filter(Boolean).join(" ; ");
      return { value: code as string, description: `Réseau ${code} : ${NETWORKS[code].label}${extra ? ` ; ${extra}` : ""}` };
    }),
    ...OTHER_ANSWERS.map((entry) => ({ value: entry.value as string, description: entry.description as string })),
  ];
}

/** The page's JSON of a request (the Decisions page JSON without its glossary, which the choices give). */
export function localModelPageJson(evidence: PageEvidence, legendImages: number) {
  return {
    plan: { mode: evidence.mode === "layers" ? "calques" : "couleurs", echelle: evidence.scale.denominator ? `1/${evidence.scale.denominator}` : "inconnue" },
    legende: evidence.legend_blocks.flatMap((block, b) => block.rows.map((row, r) => ({ ligne: `b${b + 1}r${r + 1}`, textes: row.texts,
      echantillons: row.samples.map((sample) => ({ couleur: sample.color, epaisseur_pt: sample.width, tiret: sample.dash })) }))),
    codes_du_plan: evidence.plan_codes.map((entry) => ({ code: entry.code, libelles: entry.count })),
    ...(evidence.mode === "layers" ? { calques: evidence.layers } : {}),
    couleurs_deja_classees: evidence.classified_colours,
    images_de_la_demande: legendImages > 0 ? "Les images jointes à la demande sont les blocs de légende du plan, rendus avec leurs textes." : "Aucun bloc de légende lu sur ce plan.",
  };
}

/** The words of one request (measured text): its groups, their images after the `legendImages` legend images. */
export function localModelPrompt(evidence: PageEvidence, groups: readonly CandidateEvidence[], legendImages: number) {
  const choices = localModelChoices(evidence);
  const imageText = "chaque image suivante est celle d'un groupe, dans l'ordre de la liste (titre en haut à gauche de chaque case) : A un tronçon du plan réel à l'échelle du tuyau, "
    + "B la même vue pâlie avec le groupe redessiné dans sa vraie couleur, C ses environs, D la page entière. ";
  return `${GROUP_DECISIONS_DEVELOPER}\n\nClasse chacun des groupes de tracés ci-dessous. Les ${legendImages} premières images sont les blocs de légende du plan ; `
    + imageText + "Compare la vraie couleur, l'épaisseur et le tiret de chaque groupe "
    + "avec la légende, et lis les libellés reliés à ses traits. Si les preuves ne suffisent pas, réponds « inconnu ».\n\n"
    + `Classes possibles (valeur : description) :\n${choices.map((choice) => `- ${choice.value} : ${choice.description}`).join("\n")}\n\n`
    + `Page (JSON) : ${JSON.stringify(localModelPageJson(evidence, legendImages))}\n\nGroupes (JSON) : ${JSON.stringify(groups.map((group) => groupJson(group)))}\n\n`
    + "Réponds par un objet JSON { \"groupes\": [ { \"groupe\": alias, \"classe\": une valeur de la liste, \"probabilite\": probabilité que cette classe soit juste (0 à 1), "
    + "\"classe_suivante\": la deuxième classe la plus probable, \"probabilite_suivante\": sa probabilité } ] }, un objet par groupe.";
}

export type LocalModelRead = { class: VectorClass | null; confidence: number | null; proposal: string | null; status: "answered" | "missing" | "invalid" };

/** A request's answer by group id: the class the model wrote and its probability, « inconnu » and « hors_liste » without class. */
export function readLocalModelAnswer(evidence: Pick<PageEvidence, "mode">, groups: readonly CandidateEvidence[], answer: LocalModelEntries) {
  const result = new Map<string, LocalModelRead>();
  for (const group of groups) {
    const entries = answer.groupes.filter((entry) => entry.groupe === group.alias);
    if (entries.length !== 1) {
      result.set(group.id, { class: null, confidence: null, proposal: null, status: entries.length === 0 ? "missing" : "invalid" });
      continue;
    }
    const [entry] = entries;
    const value = classOfAnswer(entry.classe);
    const known = value !== null || entry.classe === "inconnu";
    if (!known || entry.probabilite === null) {
      result.set(group.id, { class: null, confidence: null, proposal: null, status: "invalid" });
      continue;
    }
    if (value === "hors_liste") {
      result.set(group.id, { class: null, confidence: entry.probabilite, proposal: horsListeProposal(group), status: "answered" });
      continue;
    }
    if (paleGuardDrops(evidence, group, value)) {
      result.set(group.id, { class: null, confidence: null, proposal: null, status: "answered" });
      continue;
    }
    result.set(group.id, { class: value, confidence: entry.probabilite, proposal: null, status: "answered" });
  }
  return result;
}

export type { NetworkCode };
