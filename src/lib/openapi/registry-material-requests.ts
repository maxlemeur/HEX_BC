import { z } from "zod";

import type { MaterialRequestLineAlertCode } from "@/lib/material-requests/alerts";
import {
  MATERIAL_REQUEST_DELIVERY_PLACES,
  MATERIAL_REQUEST_FILE_MIME_TYPES,
  MATERIAL_REQUEST_FILE_REJECTION_REASONS,
  MATERIAL_REQUEST_IMPUTATIONS,
  MATERIAL_REQUEST_LINE_STATUSES,
  MATERIAL_REQUEST_MAX_FILES,
  MATERIAL_REQUEST_MAX_LINES,
  bulkUpdateMaterialRequestLinesSchema,
  completeMaterialRequestFilesSchema,
  createMaterialRequestLinesSchema,
  createMaterialRequestSchema,
  createMaterialRequestTechnicianSchema,
  materialRequestLineIdsSchema,
  prepareMaterialRequestFilesSchema,
  updateMaterialRequestFileSchema,
  updateMaterialRequestLineSchema,
  updateMaterialRequestSchema,
  updateMaterialRequestTechnicianSchema,
  type MaterialRequest,
  type MaterialRequestFile,
  type MaterialRequestFileUploads,
  type MaterialRequestLine,
  type MaterialRequestSummary,
  type MaterialRequestTechnician,
  type MaterialRequestUpdateResult,
} from "@/lib/material-requests/contracts";
import {
  jsonBody, jsonResponse, pathParameter, queryParameter, schemaDefinition,
  successResponseSchemaDefinition, type OpenApiOperationDefinition, type OpenApiResponseDefinition,
} from "@/lib/openapi/registry-helpers";

// TI-690: material requests of an affaire and the tenant's technicians. The record schemas restate the
// contract types of src/lib/material-requests/contracts.ts; their annotations fail to compile if they drift.

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string();

const technician: z.ZodType<MaterialRequestTechnician> = z.object({
  id: uuid, name: z.string(), current_project_id: uuid.nullable(), is_active: z.boolean(),
});
const requestShape = {
  id: uuid, project_id: uuid, technician_id: uuid.nullable(), requested_on: date, needed_on: date.nullable(),
  delivery_place: z.enum(MATERIAL_REQUEST_DELIVERY_PLACES).nullable(), is_urgent: z.boolean(),
  presumed_material: z.string().nullable(), material_confirmed: z.boolean(), presumed_supplier_id: uuid.nullable(),
  supplier_confirmed: z.boolean(), source_text: z.string().nullable(), note: z.string().nullable(),
  created_at: timestamp, updated_at: timestamp,
};
const request: z.ZodType<MaterialRequest> = z.object(requestShape);
const summaryShape = {
  ...requestShape, technician_name: z.string().nullable(), line_count: z.number().int().min(0),
  validated_line_count: z.number().int().min(0), file_count: z.number().int().min(0),
};
const summary: z.ZodType<MaterialRequestSummary> = z.object(summaryShape);
const file: z.ZodType<MaterialRequestFile> = z.object({
  id: uuid, request_id: uuid, file_name: z.string(), mime_type: z.enum(MATERIAL_REQUEST_FILE_MIME_TYPES),
  byte_size: z.number().int().positive(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  created_at: timestamp,
});
const line: z.ZodType<MaterialRequestLine> = z.object({
  id: uuid, request_id: uuid, position: z.number().int().positive(), original_text: z.string().nullable(),
  quantity: z.number().positive().nullable(), quantity_doubtful: z.boolean(), unit: z.string().nullable(),
  dimension: z.string().nullable(), no_dimension: z.boolean(), product_type: z.string().nullable(),
  material: z.string().nullable(), material_precision: z.string().nullable(), reference: z.string().nullable(),
  supplier_id: uuid.nullable(), zone: z.string().nullable(), imputation: z.enum(MATERIAL_REQUEST_IMPUTATIONS),
  overhead_category: z.string().nullable(), duplicate_acknowledged: z.boolean(),
  status: z.enum(MATERIAL_REQUEST_LINE_STATUSES), validated_at: timestamp.nullable(),
});
const uploads: z.ZodType<MaterialRequestFileUploads> = z.object({
  uploads: z.array(z.object({
    file: z.object({ id: uuid, file_name: z.string(), mime_type: z.enum(MATERIAL_REQUEST_FILE_MIME_TYPES), byte_size: z.number().int().positive() }),
    path: z.string(),
    token: z.string(),
  })),
});
const updateResult: z.ZodType<MaterialRequestUpdateResult> = z.object({ request, reopened_line_ids: z.array(uuid) });
const detailShape = { request, technician: technician.nullable(), files: z.array(file), lines: z.array(line) };
const deleted = z.object({ deleted: z.literal(true) });

// Every alert code, by construction: a code added to alerts.ts fails to compile here until it is listed.
const alertCodes: Record<MaterialRequestLineAlertCode, true> = {
  quantity_missing: true, quantity_doubtful: true, unit_missing: true, type_missing: true, dimension_missing: true,
  material_missing: true, material_unconfirmed: true, material_conflict: true, possible_duplicate: true,
};
const alertCode = z.enum(Object.keys(alertCodes) as [MaterialRequestLineAlertCode, ...MaterialRequestLineAlertCode[]]);

const failure = schemaDefinition("ApiMaterialRequestError", z.object({
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
}), "output");
const blocked = schemaDefinition("ApiMaterialRequestLinesBlocked", z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.literal("MATERIAL_REQUEST_LINES_BLOCKED"),
    message: z.string(),
    details: z.object({
      blocked: z.array(z.object({ id: uuid, codes: z.array(alertCode).min(1) })).min(1),
    }),
  }),
}), "output");

const fileRejected = schemaDefinition("ApiMaterialRequestFileRejected", z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.literal("MATERIAL_REQUEST_FILE_REJECTED"),
    message: z.string(),
    details: z.object({
      rejected: z.array(z.object({ id: uuid, reason: z.enum(MATERIAL_REQUEST_FILE_REJECTION_REASONS) })).min(1),
    }),
  }),
}), "output");

const success = (name: string, description: string, data: z.ZodType) =>
  jsonResponse(description, successResponseSchemaDefinition(name, data));
const refusal = (description: string): OpenApiResponseDefinition => jsonResponse(description, failure);
const readRefusals = {
  "403": refusal("FORBIDDEN : l'affaire n'est lisible que par son propriétaire, un administrateur ou un directeur."),
  "404": refusal("NOT_FOUND : affaire d'un autre tenant ou archivée, ou identifiant d'une autre affaire."),
};
const writeRefusals = {
  "403": refusal("FORBIDDEN : l'écriture demande le propriétaire de l'affaire ou un administrateur, avec le rôle admin ou engineer."),
  "404": readRefusals["404"],
};

const project = pathParameter({ name: "projectId", description: "Affaire du tenant actif.", schemaName: "MaterialRequestProjectId", schema: uuid });
const requestId = pathParameter({ name: "requestId", description: "Demande de cette affaire.", schemaName: "MaterialRequestId", schema: uuid });
const lineId = pathParameter({ name: "lineId", description: "Ligne de cette demande.", schemaName: "MaterialRequestLineId", schema: uuid });
const fileId = pathParameter({ name: "fileId", description: "Original de cette demande.", schemaName: "MaterialRequestFileId", schema: uuid });
const technicianId = pathParameter({ name: "technicianId", description: "Technicien du tenant actif.", schemaName: "MaterialRequestTechnicianId", schema: uuid });

const base = "/api/affaires/{projectId}/material-requests";
const one = `${base}/{requestId}`;
const technicians = "/api/material-request-technicians";
const tags = ["Demandes de matériel"];
const linesData = z.object({ lines: z.array(line) });
const draftRule = "Modifier ce que dit une ligne validée (tout sauf duplicate_acknowledged) la ramène en brouillon ; renvoyer les mêmes valeurs ne change rien.";

export const materialRequestOperations: OpenApiOperationDefinition[] = [
  {
    tags, method: "get", path: base, summary: "Lister les demandes de matériel d'une affaire",
    description: "Demandes de l'affaire, la plus récente d'abord, avec leurs compteurs, les techniciens du tenant et le droit d'écriture de l'appelant.",
    parameters: [project],
    responses: {
      "200": success("ApiMaterialRequestList", "Demandes de l'affaire.", z.object({ items: z.array(summary), technicians: z.array(technician), canWrite: z.boolean() })),
      ...readRefusals,
    },
  },
  {
    tags, method: "post", path: base, summary: "Enregistrer une demande de matériel",
    description: "Crée la demande au nom de l'appelant. Technicien et fournisseur présumé doivent appartenir au tenant actif ; une confirmation exige la valeur qu'elle confirme.",
    parameters: [project],
    requestBody: jsonBody({ name: "MaterialRequestCreate", description: "En-tête de la demande ; chaque champ est facultatif.", schema: createMaterialRequestSchema }),
    responses: { "201": success("ApiMaterialRequestCreated", "Demande créée, sans ligne ni original.", z.object(detailShape)), ...writeRefusals },
  },
  {
    tags, method: "get", path: one, summary: "Ouvrir une demande de matériel",
    description: "La demande, son technicien, ses originaux, ses lignes dans l'ordre, les matières connues du catalogue du tenant et ses fournisseurs actifs.",
    parameters: [project, requestId],
    responses: {
      "200": success("ApiMaterialRequestDetail", "Demande et listes de choix.", z.object({
        ...detailShape, canWrite: z.boolean(), materialOptions: z.array(z.string()),
        supplierOptions: z.array(z.object({ id: uuid, name: z.string() })),
      })),
      ...readRefusals,
    },
  },
  {
    tags, method: "patch", path: one, summary: "Modifier l'en-tête d'une demande",
    description: "Seuls les champs envoyés changent. Changer ou vider la matière ou le fournisseur présumé retire sa confirmation ; une confirmation envoyée avec la nouvelle valeur est enregistrée après elle. Renvoyer la même valeur conserve la confirmation. Une confirmation porte sur la valeur vue par son auteur : envoyée avec la valeur, elle ne confirme que celle-ci ; envoyée seule, elle confirme la valeur enregistrée, sauf si expected_presumed_material ou expected_presumed_supplier_id (facultatifs) précise la valeur affichée, auquel cas rien n'est écrit si elle a changé. Changer, vider ou ne plus confirmer la matière présumée ramène en brouillon les lignes validées qui s'appuyaient sur elle (sans matière propre, hors frais généraux) : reopened_line_ids les nomme, tableau vide sinon.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestUpdate", description: "Au moins un champ.", schema: updateMaterialRequestSchema }),
    responses: {
      "200": success("ApiMaterialRequestUpdated", "Demande enregistrée et lignes ramenées en brouillon.", updateResult),
      ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_PRESUMPTION_CHANGED : la matière ou le fournisseur présumé a été modifié entre-temps ; la confirmation n'est pas enregistrée, recharger la demande."),
    },
  },
  {
    tags, method: "delete", path: one, summary: "Supprimer une demande",
    description: "Supprime la demande, ses lignes et ses originaux, octets compris.",
    parameters: [project, requestId],
    responses: { "200": success("ApiMaterialRequestDeleted", "Demande supprimée.", deleted), ...writeRefusals },
  },
  {
    tags, method: "post", path: `${one}/files`, summary: "Préparer le dépôt d'originaux",
    description: `Les photos ne passent pas par l'application : le navigateur les envoie au stockage. Cet appel vérifie ce qui est annoncé (de 1 à ${MATERIAL_REQUEST_MAX_FILES} images JPEG, PNG ou WebP de 20 Mo au plus, nom et type concordants, ${MATERIAL_REQUEST_MAX_FILES} originaux conservés par demande), enregistre une ligne invisible par photo et signe un envoi par photo avec la session de l'appelant, sans écrasement possible. Le navigateur envoie ensuite chaque fichier avec uploadToSignedUrl(path, token, fichier) sur le bucket material-requests, puis appelle files/complete. Un seul fichier refusé refuse le lot.`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestFilesPrepare", description: "Nom, type déclaré et taille de chaque photo.", schema: prepareMaterialRequestFilesSchema }),
    responses: {
      "201": success("ApiMaterialRequestFilesPrepared", "Un envoi signé par photo, valable deux heures.", uploads),
      ...writeRefusals,
      "413": refusal("PAYLOAD_TOO_LARGE : une photo annoncée dépasse 20 Mo."),
      "422": refusal("MATERIAL_REQUEST_HEIC_UNSUPPORTED : photo HEIC, à enregistrer en JPEG. MATERIAL_REQUEST_FILE_LIMIT : la demande garderait plus de 12 originaux. MATERIAL_REQUEST_UPLOADS_PENDING : plus de 24 photos attendraient leurs octets sur cette demande."),
    },
  },
  {
    tags, method: "post", path: `${one}/files/complete`, summary: "Terminer le dépôt d'originaux",
    description: "Vérifie dans le stockage chaque photo préparée : présente, de la taille annoncée, et dont les premiers octets sont ceux du type annoncé. Tout ou rien : si une photo échoue, aucune du lot n'est conservée (lignes et octets retirés) ; sinon le lot devient visible en une seule écriture. Un original n'est listé, compté et servi qu'après cet appel. Une photo déjà conservée, nommée à nouveau, est retournée sans être relue.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestFilesComplete", description: "Identifiants reçus à la préparation.", schema: completeMaterialRequestFilesSchema }),
    responses: {
      "200": success("ApiMaterialRequestFilesCompleted", "Originaux conservés, dans l'ordre demandé.", z.object({ files: z.array(file) })),
      ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_UPLOAD_CHANGED : une photo du lot a été annulée entre-temps ; celles déjà visibles le restent, recharger la demande."),
      "422": jsonResponse("MATERIAL_REQUEST_FILE_REJECTED : chaque photo refusée et sa raison (missing, size, type) ; aucune du lot n'est conservée. Même statut, code MATERIAL_REQUEST_FILE_LIMIT, sans details.rejected, quand le lot ferait dépasser 12 originaux : il est alors écarté en entier.", fileRejected),
    },
  },
  {
    tags, method: "get", path: `${one}/files/{fileId}`, summary: "Lire un original",
    description: "Octets de l'image, servis par l'application à qui peut lire l'affaire : aucune URL signée. Réponse privée, non stockable, sans détection de type. Un original dont les octets ne sont pas conservés répond 404.",
    parameters: [project, requestId, fileId],
    responses: {
      "200": { description: "Image d'origine, jamais réécrite.", contents: MATERIAL_REQUEST_FILE_MIME_TYPES.map((contentType) => ({ contentType })) },
      ...readRefusals,
    },
  },
  {
    tags, method: "patch", path: `${one}/files/{fileId}`, summary: "Tourner un original",
    description: "Rotation d'affichage par quarts de tour ; les octets conservés ne changent pas.",
    parameters: [project, requestId, fileId],
    requestBody: jsonBody({ name: "MaterialRequestFileUpdate", description: "Rotation en degrés.", schema: updateMaterialRequestFileSchema }),
    responses: { "200": success("ApiMaterialRequestFileUpdated", "Rotation enregistrée.", z.object({ file })), ...writeRefusals },
  },
  {
    tags, method: "delete", path: `${one}/files/{fileId}`, summary: "Supprimer un original",
    description: "Retire l'original de toute lecture, puis supprime ses octets et sa ligne. Vaut aussi pour une photo préparée mais pas encore conservée : c'est ainsi qu'un dépôt s'annule, et un envoi encore en cours n'aboutit plus.",
    parameters: [project, requestId, fileId],
    responses: { "200": success("ApiMaterialRequestFileDeleted", "Original supprimé.", deleted), ...writeRefusals },
  },
  {
    tags, method: "post", path: `${one}/lines`, summary: "Ajouter des lignes à une demande",
    description: `Lignes en brouillon, ajoutées après les lignes existantes dans l'ordre reçu ; une ligne vide est acceptée. Une demande compte ${MATERIAL_REQUEST_MAX_LINES} lignes au plus.`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesCreate", description: "Lignes à ajouter.", schema: createMaterialRequestLinesSchema }),
    responses: {
      "201": success("ApiMaterialRequestLinesCreated", "Lignes ajoutées.", linesData),
      ...writeRefusals,
      "409": refusal("CONFLICT : d'autres lignes viennent d'être ajoutées ; recharger la demande."),
      "422": refusal(`MATERIAL_REQUEST_LINE_LIMIT : la demande dépasserait ${MATERIAL_REQUEST_MAX_LINES} lignes ; aucune n'est ajoutée.`),
    },
  },
  {
    tags, method: "patch", path: `${one}/lines`, summary: "Appliquer une modification à une sélection de lignes",
    description: `Applique les mêmes valeurs aux lignes désignées et retourne ces lignes. ${draftRule}`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesBulkUpdate", description: "Lignes de la demande et valeurs à appliquer.", schema: bulkUpdateMaterialRequestLinesSchema }),
    responses: { "200": success("ApiMaterialRequestLinesUpdated", "Lignes de la sélection.", linesData), ...writeRefusals },
  },
  {
    tags, method: "patch", path: `${one}/lines/{lineId}`, summary: "Modifier une ligne",
    description: `Seuls les champs envoyés changent. ${draftRule} Changer le type, la dimension, la matière, la zone ou l'imputation d'une ligne retire son « doublon vu », sauf si la même requête le redonne. Statut, position et validation ne se modifient pas ici.`,
    parameters: [project, requestId, lineId],
    requestBody: jsonBody({ name: "MaterialRequestLineUpdate", description: "Au moins un champ.", schema: updateMaterialRequestLineSchema }),
    responses: { "200": success("ApiMaterialRequestLineUpdated", "Ligne enregistrée.", z.object({ line })), ...writeRefusals },
  },
  {
    tags, method: "delete", path: `${one}/lines/{lineId}`, summary: "Supprimer une ligne",
    description: "Supprime la ligne ; les positions des autres lignes ne changent pas.",
    parameters: [project, requestId, lineId],
    responses: { "200": success("ApiMaterialRequestLineDeleted", "Ligne supprimée.", deleted), ...writeRefusals },
  },
  {
    tags, method: "post", path: `${one}/lines/validate`, summary: "Valider des lignes",
    description: "Tout ou rien : les alertes sont calculées sur toutes les lignes de la demande (un doublon peut être hors sélection). Si une ligne désignée garde une alerte bloquante, aucune n'est validée. La base refuse elle-même une ligne sans matière (ni propre, ni présumée et confirmée, hors frais généraux) ; le doublon n'est vérifié que par l'application. Auteur et date de validation sont fixés par le serveur.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesValidate", description: "Lignes à valider.", schema: materialRequestLineIdsSchema }),
    responses: {
      "200": success("ApiMaterialRequestLinesValidated", "Lignes désignées, toutes validées.", linesData),
      ...writeRefusals,
      "422": jsonResponse("MATERIAL_REQUEST_LINES_BLOCKED : chaque ligne retenue et ses alertes bloquantes ; rien n'est validé.", blocked),
    },
  },
  {
    tags, method: "post", path: `${one}/lines/reopen`, summary: "Rouvrir des lignes validées",
    description: "Ramène en brouillon les lignes désignées ; auteur et date de validation sont effacés.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesReopen", description: "Lignes à rouvrir.", schema: materialRequestLineIdsSchema }),
    responses: { "200": success("ApiMaterialRequestLinesReopened", "Lignes désignées, en brouillon.", linesData), ...writeRefusals },
  },
  {
    tags, method: "get", path: technicians, summary: "Lister les techniciens du tenant",
    description: "Liste de noms, actifs ou non, lisible par tout membre du tenant actif. Les techniciens n'ont pas de compte.",
    responses: { "200": success("ApiMaterialRequestTechnicians", "Techniciens par nom.", z.object({ items: z.array(technician) })) },
  },
  {
    tags, method: "post", path: technicians, summary: "Ajouter un technicien",
    description: "Réservé aux rôles admin et engineer. Un nom est unique dans le tenant, quelles que soient sa casse et ses espaces.",
    requestBody: jsonBody({ name: "MaterialRequestTechnicianCreate", description: "Nom et, au besoin, chantier actuel.", schema: createMaterialRequestTechnicianSchema }),
    responses: {
      "201": success("ApiMaterialRequestTechnicianCreated", "Technicien ajouté.", z.object({ item: technician })),
      "403": refusal("FORBIDDEN : rôle admin ou engineer requis."),
      "409": refusal("MATERIAL_REQUEST_TECHNICIAN_EXISTS : « Ce technicien existe déjà. »"),
    },
  },
  {
    tags, method: "patch", path: `${technicians}/{technicianId}`, summary: "Modifier un technicien",
    description: "Nom, chantier actuel ou activité. Un technicien se désactive, il ne se supprime pas.",
    parameters: [technicianId],
    requestBody: jsonBody({ name: "MaterialRequestTechnicianUpdate", description: "Au moins un champ.", schema: updateMaterialRequestTechnicianSchema }),
    responses: {
      "200": success("ApiMaterialRequestTechnicianUpdated", "Technicien enregistré.", z.object({ item: technician })),
      "403": refusal("FORBIDDEN : rôle admin ou engineer requis."),
      "409": refusal("MATERIAL_REQUEST_TECHNICIAN_EXISTS : « Ce technicien existe déjà. »"),
    },
  },
  {
    tags, method: "get", path: `${technicians}/{technicianId}/requests`, summary: "Lire les dernières demandes d'un technicien",
    description: "Ses demandes les plus récentes dans les affaires non archivées que l'appelant peut lire, avec leurs lignes dans l'ordre.",
    parameters: [
      technicianId,
      queryParameter({ name: "limit", description: "Nombre de demandes, 10 par défaut, 20 au plus.", schemaName: "MaterialRequestTechnicianHistoryLimit", schema: z.number().int().min(1).max(20) }),
    ],
    responses: {
      "200": success("ApiMaterialRequestTechnicianHistory", "Demandes du technicien, la plus récente d'abord.", z.object({
        items: z.array(z.object({ request: z.object({ ...summaryShape, project_name: z.string() }), lines: z.array(line) })),
      })),
    },
  },
];
