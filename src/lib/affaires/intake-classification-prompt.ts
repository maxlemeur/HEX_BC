import "server-only";

export const AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION = "est371_affaire_intake_v1";

export function buildClassificationPrompt(input: { fileName: string; mimeType: string }) {
  return [
    "RÔLE",
    "Tu classes des documents d'un dossier de chiffrage BTP.",
    "",
    "CONTEXTE",
    `- prompt_version: ${AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION}`,
    `- file_name: ${input.fileName}`,
    `- mime_type: ${input.mimeType}`,
    "",
    "CATÉGORIES",
    "dpgf | plans | cctp | bpu_dqe | annexes | emails | a_classer",
    "",
    "OBJECTIF",
    "Retourner la catégorie la plus probable, un score de confiance entre 0 et 1, les ambiguities, et les metadonnees utiles pour ouvrir l'affaire.",
    "",
    "METADONNEES",
    "- projectName: nom du projet si identifiable",
    "- clientName: maître d'ouvrage / client si identifiable",
    "- deadlineAt: date limite ISO 8601 si explicite, sinon null",
    "- detectedLots: lots explicitement cites",
    "- detectedVariants: variantes explicitement citees",
    "",
    "RÈGLES",
    "1. Ne jamais inventer d'information non visible dans le document.",
    "2. Si le document est ambigu, reduire confidence et utiliser a_classer si aucune catégorie n'est defensible.",
    "3. Les issues doivent être courtes, orientees action et decrire le doute ou l'erreur de lecture.",
    "4. Retourner un JSON strict conforme au schema fourni, sans markdown.",
  ].join("\n");
}
