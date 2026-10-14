import { z } from "zod";
import {
  coverageCitationVerificationSchema, coverageDecisionMutationSchema,
  coverageDimensionMutationSchema, coverageErrorResponseSchema, coverageMutationResultSchema,
  coveragePreviewSchema, coverageQuerySchema, coverageRequirementMutationSchema,
  coverageTargetsQuerySchema, coverageTargetsSchema, coverageWorkspaceSchema,
} from "@/lib/estimates/source-coverage-contracts";
import {
  headerParameter, jsonBody, jsonResponse, pathParameter, queryParameter,
  responseHeader, schemaDefinition, type OpenApiOperationDefinition,
  type OpenApiResponseDefinition,
} from "@/lib/openapi/registry-helpers";

const base = "/api/estimates/{versionId}/source-review/requirements";
const version = pathParameter({ name: "versionId", description: "Version de devis examinée.", schemaName: "CoverageVersionId", schema: z.string().uuid() });
const requirement = pathParameter({ name: "requirementId", description: "Exigence de cette version ; doit correspondre au corps.", schemaName: "CoverageRequirementId", schema: z.string().uuid() });
const origin = headerParameter({ name: "Origin", description: "Origine exacte de la requête, obligatoire pour une écriture.", schemaName: "CoverageOrigin", schema: z.string(), required: true });
const cache = responseHeader({ name: "Cache-Control", description: "Chaque réponse, succès ou erreur, est privée et non stockable.", schemaName: "CoverageCacheControl", schema: z.literal("private, no-store"), required: true });
const failure = schemaDefinition("ApiSourceCoverageError", coverageErrorResponseSchema, "output");
const mutation = schemaDefinition("ApiSourceCoverageMutation", z.strictObject({ ok: z.literal(true), data: coverageMutationResultSchema }), "output");

function responses(schema: ReturnType<typeof schemaDefinition>, write = false): Record<string, OpenApiResponseDefinition> {
  const response = (description: string, success = false) => ({ ...jsonResponse(description, success ? schema : failure), headers: [cache] });
  return {
    "200": response(write ? "Reçu initial d'une intention identique, avec sa révision courante distincte." : "Lecture autorisée et validée.", true),
    ...(write ? { "201": response("Intention enregistrée atomiquement avec son événement et son reçu.", true) } : {}),
    "400": response("SOURCE_COVERAGE_INVALID_INPUT : paramètres, corps, identités ou pagination invalides."),
    "401": response("UNAUTHORIZED : session absente ou invalide."),
    ...(write ? { "403": response("SOURCE_COVERAGE_WRITE_FORBIDDEN : origine ou droit d'écriture refusé."), "413": response("SOURCE_COVERAGE_PAYLOAD_TOO_LARGE : corps supérieur à 131072 octets UTF-8 réellement lus.") } : {}),
    "404": response("SOURCE_COVERAGE_ACCESS_DENIED : revue inaccessible, sans révéler son existence."),
    "409": response("Conflit de révision ou de clé, dépendance indisponible, rapprochement incomplet ou citation non vérifiée ; aucune décision partielle."),
    "500": response("INTERNAL_ERROR : résultat de base incohérent ou erreur inattendue, sans détail SQL."),
    "503": response("SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE : vérification impossible ; ne vaut ni état vide ni décision à jour."),
  };
}
function queries(prefix: string, shape: Record<string, z.ZodType>) {
  return Object.entries(shape).map(([name, schema]) => queryParameter({ name, schemaName: `${prefix}${name[0].toUpperCase()}${name.slice(1)}`, schema, description: `Paramètre ${name}. Les paramètres inconnus ou répétés sont refusés.` }));
}
const common = { tags: ["Estimate Versions"], omitDefaultErrorResponses: true };
const writeDescription = "JSON strict de 128 Kio au plus, aucune query, UUID minuscules. Droits admin ou engineer propriétaire, tenant actif, affaire non archivée et version brouillon vérifiés au commit. Même clé et même corps rejouent le reçu sans nouvel événement ; une autre intention sous cette clé est refusée. Aucun montant ou export financier n'est modifié.";

export const sourceCoverageOperations: OpenApiOperationDefinition[] = [
  {
    ...common, method: "get", path: base, summary: "Lire les exigences identifiées et leur couverture",
    description: "Lecture paginée des exigences actives ou sélectionnées, dimensions d'affaire, décisions et historique. La validité dépend des références et faits techniques examinés. Les compteurs ne mesurent pas l'exhaustivité du CCTP. operationKey retrouve le reçu de l'acteur indépendamment de la pagination. Une version sans revue ne crée aucune donnée.",
    parameters: [version, ...queries("CoverageRead", coverageQuerySchema.shape)],
    responses: responses(schemaDefinition("ApiSourceCoverageWorkspace", z.strictObject({ ok: z.literal(true), data: coverageWorkspaceSchema }), "output")),
  },
  {
    ...common, method: "post", path: base, summary: "Enregistrer, archiver ou rouvrir une exigence",
    description: `${writeDescription} L'agrégat prescription, périmètre, citations et liens est enregistré ensemble. La complétude reste une déclaration humaine motivée. Les vérifications de citation ne proviennent jamais du client.`,
    parameters: [version, origin], requestBody: jsonBody({ name: "SourceCoverageRequirementMutation", description: "Agrégat d'exigence ou intention d'archivage/réouverture avec révision attendue.", schema: coverageRequirementMutationSchema, required: true }), responses: responses(mutation, true),
  },
  {
    ...common, method: "post", path: `${base}/dimensions`, summary: "Gérer les zones et réseaux de l'affaire",
    description: `${writeDescription} Les identités de zone et réseau sont distinctes et stables. Le renommage conserve la validité ; changer l'étendue ou archiver rend les décisions liées à revérifier. Le contexte DPGF d'une exigence reste un choix distinct.`,
    parameters: [version, origin], requestBody: jsonBody({ name: "SourceCoverageDimensionMutation", description: "Intention sur une zone ou un réseau identifié dans l'affaire.", schema: coverageDimensionMutationSchema, required: true }), responses: responses(mutation, true),
  },
  {
    ...common, method: "get", path: `${base}/targets`, summary: "Chercher des prestations et points du registre à rapprocher",
    description: "Catalogue technique paginé, dans les droits actuels de cette revue. Les composants sont regroupés sous leur ligne réellement appliquée. Une suggestion ou un modèle de bibliothèque n'est pas une preuve d'inclusion. Aucun prix ou coût caché n'est retourné.",
    parameters: [version, ...queries("CoverageTargets", coverageTargetsQuerySchema.shape)],
    responses: {
      ...responses(schemaDefinition("ApiSourceCoverageTargets", z.strictObject({ ok: z.literal(true), data: coverageTargetsSchema }), "output")),
      "413": { ...jsonResponse("SOURCE_COVERAGE_PAYLOAD_TOO_LARGE : plus de 100 composants rencontrés sur la page ; préciser la recherche ou réduire la taille de page.", failure), headers: [cache] },
    },
  },
  {
    ...common, method: "get", path: `${base}/{requirementId}/preview`, summary: "Examiner les faits avant une décision de couverture",
    description: "Retourne les faits courants, blocages, révisions et empreinte à confirmer. Cette lecture n'est pas une décision et ne change aucune validité. Aucun paramètre de requête n'est accepté.",
    parameters: [version, requirement], responses: responses(schemaDefinition("ApiSourceCoveragePreview", z.strictObject({ ok: z.literal(true), data: coveragePreviewSchema }), "output")),
  },
  {
    ...common, method: "post", path: `${base}/{requirementId}/citations/verify`, summary: "Confirmer humainement un passage du CCTP conservé",
    description: `${writeDescription} Le serveur relit les octets privés et vérifie hash, PDF et page ; cette vérification technique ne certifie pas le sens de l'extrait. L'acteur confirme avoir examiné ce passage. Citation et référence sont revérifiées sous verrou.`,
    parameters: [version, requirement, origin], requestBody: jsonBody({ name: "SourceCoverageCitationVerification", description: "Passage, copie et révisions réellement examinés par l'acteur.", schema: coverageCitationVerificationSchema, required: true }), responses: responses(mutation, true),
  },
  {
    ...common, method: "post", path: `${base}/{requirementId}/decisions`, summary: "Décider ou revérifier le traitement d'une exigence",
    description: `${writeDescription} Décision immuable avec faits, sources, auteur et motif. Un rapprochement partiel ne peut devenir chiffré ou inclus. Les traitements exclu, autre lot et provisoire gardent leurs obligations propres. Un changement de quantité puis retour à sa valeur ne ressuscite pas une décision ; prix, marge et ordre seuls n'invalident pas la couverture technique.`,
    parameters: [version, requirement, origin], requestBody: jsonBody({ name: "SourceCoverageDecisionMutation", description: "Traitement motivé et empreinte de l'aperçu effectivement revu.", schema: coverageDecisionMutationSchema, required: true }), responses: responses(mutation, true),
  },
];
