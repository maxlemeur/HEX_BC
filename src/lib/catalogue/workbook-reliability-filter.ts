import { foldText } from "@/lib/text/fold";

export const ZERO_RELIABILITY_CRITERION = "Fiabilité à zéro";

/** Recognise a complete, single criterion. Combined conditions stay with the assistant. */
export function isZeroReliabilityCriterion(question: string) {
  const text = foldText(question).trim().replace(/’/g, "'").replace(/\s+/g, " ").replace(/[.!?]+$/, "").trimEnd();
  const criterion = text.replace(/^(?:(?:peux-tu|pourrais-tu) )?(?:ecarte(?:r|z)?|exclu(?:s|ez|re)|supprime(?:r|z)?|retire(?:r|z)?) (?:toutes les |les )?lignes? (?:dont |avec |ayant )?/, "");
  return /^(?:(?:la|une) )?(?:note de )?fiabilite\s*(?:est(?: (?:egale )?a)?|egale a|a|=)\s*(?:zero|0(?:[.,]0+)?)(?: (?:dans|sur) (?:le fichier excel|l'excel|le classeur)(?: d'origine)?)?$/.test(criterion);
}

export function isZeroReliabilityCell(value: string | number | boolean | null) {
  return value === 0 || (typeof value === "string" && /^[+-]?0+(?:[.,]0+)?$/.test(value.trim()));
}
