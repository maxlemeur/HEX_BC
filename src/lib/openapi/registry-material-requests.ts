import { z } from "zod";

import type { MaterialRequestLineAlertCode } from "@/lib/material-requests/alerts";
import { affaireSupplyCostSchema } from "@/lib/material-requests/supply-cost-contracts";
import {
  MATERIAL_REQUEST_DELIVERY_PLACES,
  MATERIAL_REQUEST_FILE_REJECTION_REASONS,
  MATERIAL_REQUEST_IMPUTATIONS,
  MATERIAL_REQUEST_LINE_STATUSES,
  MATERIAL_REQUEST_MAX_FILES,
  MATERIAL_REQUEST_MAX_LINES,
  MATERIAL_REQUEST_PRODUCT_MATCHES,
  bulkUpdateMaterialRequestLinesSchema,
  createMaterialRequestLineArticleSchema,
  completeMaterialRequestFilesSchema,
  createMaterialRequestLinesSchema,
  createMaterialRequestSchema,
  createMaterialRequestTechnicianSchema,
  linkMaterialRequestLineArticleSchema,
  materialRequestLineIdsSchema,
  prepareMaterialRequestFilesSchema,
  replaceMaterialRequestLinesSchema,
  updateMaterialRequestFileSchema,
  updateMaterialRequestLineSchema,
  updateMaterialRequestSchema,
  updateMaterialRequestTechnicianSchema,
  type MaterialRequest,
  type MaterialRequestArticleCandidate,
  type MaterialRequestArticleSummary,
  type MaterialRequestFile,
  type MaterialRequestFileUploads,
  type MaterialRequestLine,
  type MaterialRequestLineArticleResult,
  type MaterialRequestPricePer,
  type MaterialRequestListItem,
  type MaterialRequestTechnician,
  type MaterialRequestUpdateResult,
} from "@/lib/material-requests/contracts";
import {
  LINE_SUPPLIER_REASONS,
  productPreferredSupplierSchema,
  retainLineSuppliersSchema,
  saveArticleSupplierItemSchema,
  supplyTypePreferredSupplierSchema,
  type ArticleSupplierItem,
  type ArticleSupplierItemSaved,
  type ArticleSuppliers,
  type LineSupplierProposal,
  type LineSupplierProposals,
  type LineSupplierReference,
  type RetainLineSuppliersResult,
} from "@/lib/material-requests/supplier-contracts";
import {
  MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES,
  MATERIAL_REQUEST_QUOTE_MAX_FILES,
  MATERIAL_REQUEST_QUOTE_MESSAGE_MAX,
  MATERIAL_REQUEST_QUOTE_STATUSES,
  createQuoteSchema,
  updateQuoteSchema,
  type MaterialRequestQuote,
  type MaterialRequestQuoteRetained,
} from "@/lib/material-requests/quote-contracts";
import {
  MATERIAL_REQUEST_ORDER_NOT_READY_REASONS,
  createMaterialRequestOrdersSchema,
  type MaterialRequestOrdersCreated,
  type MaterialRequestOrdersSummary,
} from "@/lib/material-requests/order-contracts";
import type { SupplyTypeListItem } from "@/lib/catalogue/supply-types";
import {
  confirmPurchaseOrderSchema,
  receivePurchaseOrderSchema,
  type PurchaseOrderConfirmed,
  type PurchaseOrderReceived,
} from "@/lib/purchase-orders/lifecycle-contracts";
import {
  jsonBody, jsonResponse, pathParameter, queryParameter, schemaDefinition,
  successResponseSchemaDefinition, type OpenApiOperationDefinition, type OpenApiResponseDefinition,
} from "@/lib/openapi/registry-helpers";

// TI-690: material requests of an affaire and the tenant's technicians. The record schemas restate the
// contract types of src/lib/material-requests/contracts.ts; their annotations fail to compile if they drift.

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string();
// How many units a price is for (TI-691): a price stays in whole cents.
const pricePer: z.ZodType<MaterialRequestPricePer> = z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]);

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
// TI-691: the lines no standing purchase order holds yet, and whether one holds any.
const listItem: z.ZodType<MaterialRequestListItem> = z.object({
  ...summaryShape, to_order_line_count: z.number().int().min(0).nullable(), has_orders: z.boolean(),
});
// An original is an image; the file of a quote (quote_id, TI-691) may also be a PDF.
const file: z.ZodType<MaterialRequestFile> = z.object({
  id: uuid, request_id: uuid, quote_id: uuid.nullable(), file_name: z.string(), mime_type: z.enum(MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES),
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
  product_id: uuid.nullable(), product_match: z.enum(MATERIAL_REQUEST_PRODUCT_MATCHES).nullable(),
  unit_price_ht_cents: z.number().int().min(0).nullable(), price_per: pricePer, price_quote_id: uuid.nullable(),
});
const articleSummary: z.ZodType<MaterialRequestArticleSummary> = z.object({
  id: uuid, reference: z.string().nullable(), designation: z.string(), product_type: z.string().nullable(),
  material: z.string().nullable(), dimensions: z.string().nullable(), unit: z.string().nullable(),
  catalogue_status: z.enum(["draft", "validated"]), created_from_material_request: z.boolean(),
  supply_type_name: z.string().nullable(),
});
const candidate: z.ZodType<MaterialRequestArticleCandidate> = z.object({
  article: articleSummary, score: z.number().int().min(0).max(100), via: z.enum(["reference", "alias", "ranked"]),
  reasons: z.array(z.string()), warnings: z.array(z.string()),
});
const articleResult: z.ZodType<MaterialRequestLineArticleResult> = z.object({
  line, article: articleSummary, alias_learned: z.string().nullable(),
});
const uploads: z.ZodType<MaterialRequestFileUploads> = z.object({
  uploads: z.array(z.object({
    file: z.object({ id: uuid, file_name: z.string(), mime_type: z.enum(MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES), byte_size: z.number().int().positive() }),
    path: z.string(),
    token: z.string(),
  })),
});
const updateResult: z.ZodType<MaterialRequestUpdateResult> = z.object({ request, reopened_line_ids: z.array(uuid) });
// TI-691: suppliers of the lines (src/lib/material-requests/supplier-contracts.ts).
const supplierReference: z.ZodType<LineSupplierReference> = z.object({
  supplier_sku: z.string().nullable(), product_url: z.string().nullable(),
});
const supplierProposal: z.ZodType<LineSupplierProposal> = z.object({
  supplier_id: uuid, supplier_name: z.string(), reason: z.enum(LINE_SUPPLIER_REASONS), confirmed: z.boolean(),
  supplier_sku: z.string().nullable(), product_url: z.string().nullable(),
});
const retainedSuppliers: z.ZodType<RetainLineSuppliersResult> = z.object({ lines: z.array(line), skipped: z.array(uuid) });
const supplierProposals: z.ZodType<LineSupplierProposals> = z.object({
  lines: z.record(z.string(), supplierProposal.nullable()),
  references: z.record(z.string(), supplierReference),
});
const articleSupplierItem: z.ZodType<ArticleSupplierItem> = z.object({
  id: uuid, supplier_id: uuid, supplier_name: z.string(), supplier_sku: z.string().nullable(),
  product_url: z.string().nullable(), is_active: z.boolean(), has_price: z.boolean(),
});
const articleSuppliers: z.ZodType<ArticleSuppliers> = z.object({
  items: z.array(articleSupplierItem), preferred_supplier_id: uuid.nullable(),
});
const articleSupplierSaved: z.ZodType<ArticleSupplierItemSaved> = z.object({
  item: articleSupplierItem, preferred_supplier_id: uuid.nullable(),
});
// TI-691: quotes of a request (src/lib/material-requests/quote-contracts.ts).
const quote: z.ZodType<MaterialRequestQuote> = z.object({
  id: uuid, request_id: uuid, supplier_id: uuid, supplier_name: z.string(), status: z.enum(MATERIAL_REQUEST_QUOTE_STATUSES),
  with_references: z.boolean(), message: z.string(), requested_at: timestamp, received_at: timestamp.nullable(),
  amount_ht_cents: z.number().int().min(0).nullable(), notes: z.string().nullable(), retained_at: timestamp.nullable(),
  closed_at: timestamp.nullable(),
  lines: z.array(z.object({ line_id: uuid, unit_price_ht_cents: z.number().int().min(0).nullable(), price_per: pricePer })),
  files: z.array(file),
});
const quoteRetained: z.ZodType<MaterialRequestQuoteRetained> = z.object({
  item: quote, lines: z.array(line), closed_quote_ids: z.array(uuid),
});
// TI-691, delivery 3a: purchase orders from a request (src/lib/material-requests/order-contracts.ts).
const ordersSummary: z.ZodType<MaterialRequestOrdersSummary> = z.object({
  ready_line_ids: z.array(uuid),
  not_ready: z.array(z.object({ line_id: uuid, reason: z.enum(MATERIAL_REQUEST_ORDER_NOT_READY_REASONS) })),
  ordered: z.array(z.object({
    line_id: uuid, purchase_order_id: uuid, purchase_order_reference: z.string(), status: z.string(), can_open: z.boolean(),
  })),
  orders: z.array(z.object({
    id: uuid, reference: z.string(), supplier_name: z.string(), status: z.string(), total_ht_cents: z.number().int(),
    line_count: z.number().int().min(0), can_open: z.boolean(),
  })),
  can_create: z.boolean(),
});
const ordersCreated: z.ZodType<MaterialRequestOrdersCreated> = z.object({
  orders: z.array(z.object({
    id: uuid, reference: z.string(), supplier_name: z.string(), status: z.string(), line_count: z.number().int().min(1),
    total_ht_cents: z.number().int().min(0),
  })),
  replayed: z.boolean(),
});
const supplyTypeItem: z.ZodType<SupplyTypeListItem> = z.object({
  id: uuid, code: z.string(), name: z.string(), preferred_supplier_id: uuid.nullable(),
  preferred_supplier_name: z.string().nullable(),
});
const detailShape = {
  request, technician: technician.nullable(), files: z.array(file), lines: z.array(line),
  articles: z.record(z.string(), articleSummary),
};
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
const fileId = pathParameter({ name: "fileId", description: "Original ou fichier d'un devis de cette demande.", schemaName: "MaterialRequestFileId", schema: uuid });
const quoteId = pathParameter({ name: "quoteId", description: "Devis de cette demande.", schemaName: "MaterialRequestQuoteId", schema: uuid });
const productId = pathParameter({ name: "productId", description: "Article du tenant actif.", schemaName: "MaterialRequestProductId", schema: uuid });
const aliasId = pathParameter({ name: "aliasId", description: "Nom usuel de cet article.", schemaName: "ProductAliasId", schema: uuid });
const supplyTypeId = pathParameter({ name: "supplyTypeId", description: "Type de fourniture du tenant actif.", schemaName: "SupplyTypeId", schema: uuid });
const technicianId = pathParameter({ name: "technicianId", description: "Technicien du tenant actif.", schemaName: "MaterialRequestTechnicianId", schema: uuid });

const base = "/api/affaires/{projectId}/material-requests";
const one = `${base}/{requestId}`;
const technicians = "/api/material-request-technicians";
const tags = ["Demandes de matériel"];

// TI-691, delivery 3b-1: ordering and receiving an order of an affaire (src/lib/purchase-orders/lifecycle-contracts.ts).
const purchaseOrderId = pathParameter({ name: "id", description: "Bon de commande d'une affaire, lisible par l'appelant.", schemaName: "PurchaseOrderLifecycleId", schema: uuid });
const orderConfirmed: z.ZodType<PurchaseOrderConfirmed> = z.object({
  id: uuid, status: z.literal("confirmed"), edit_revision: z.number().int().min(0), order_date: date,
  // AAAA-MM-JJ, or « TBD » for a delivery still to be determined (the draft editor's value).
  expected_delivery_date: z.string().nullable(), total_ht_cents: z.number().int(), total_tax_cents: z.number().int(),
  total_ttc_cents: z.number().int(),
});
const orderReceived: z.ZodType<PurchaseOrderReceived> = z.object({
  id: uuid, status: z.literal("received"), edit_revision: z.number().int().min(0),
});
const lifecycleRights = refusal("FORBIDDEN : seuls l'auteur du bon et les administrateurs, avec le rôle admin ou engineer, l'écrivent.");
const lifecycleNotFound = refusal("NOT_FOUND : bon introuvable ou illisible pour l'appelant.");
const lifecycleTags = ["Achats"];
const linesData = z.object({ lines: z.array(line) });
const articleRule = "Rattacher, changer ou retirer l'article d'une ligne validée la ramène en brouillon.";
const linePriced = refusal("MATERIAL_REQUEST_LINE_PRICED : la ligne a un devis retenu, sans retour possible dans cette livraison ; son fournisseur est celui du devis, ce qu'elle commande (article, type, dimension ou sans dimension, matière, précision, référence, unité, quantité) ne change plus, et elle ne se supprime plus seule (sa demande, si). Refusé seul ou dans une sélection, rien n'est écrit ; zone, imputation, mots du technicien, doute sur la quantité et doublon vu restent modifiables. details : line_ids, positions.");
const quoteBusy = "MATERIAL_REQUEST_QUOTE_BUSY : une autre modification était en cours (la base a levé un interblocage) ; rien n'est écrit, réessayer.";
const quoteReadOnly = refusal("MATERIAL_REQUEST_QUOTE_READ_ONLY : le devis est retenu ou clos ; il ne se modifie plus, ses fichiers compris. details.status.");
const lineOrdered = "MATERIAL_REQUEST_LINE_ORDERED : la ligne est dans un bon de commande qui n'est pas annulé ; elle ne revient pas en brouillon, ni rouverte ni par une modification de ce qu'elle dit (zone, imputation, mots du technicien) : « La ligne N est dans le bon C-… : elle ne peut plus être rouverte. » Rien n'est écrit, même dans une sélection. details : line_ids, positions, references.";
const draftRule = "Modifier ce que dit une ligne validée (tout sauf duplicate_acknowledged et supplier_id, le fournisseur d'achat choisi par le bureau) la ramène en brouillon ; renvoyer les mêmes valeurs ne change rien.";
const catalogueEditorRefusals = {
  "403": refusal("FORBIDDEN : réservé aux administrateurs et aux ingénieurs ; un ingénieur ne modifie que les articles qu'il a ajoutés, sauf si un administrateur a ouvert la base commune (TI-689)."),
  "404": refusal("NOT_FOUND : article ou fournisseur d'un autre tenant, ou inconnu."),
};

export const materialRequestOperations: OpenApiOperationDefinition[] = [
  {
    tags, method: "get", path: base, summary: "Lister les demandes de matériel d'une affaire",
    description: "Demandes de l'affaire, la plus récente d'abord, avec leurs compteurs, les techniciens du tenant et le droit d'écriture de l'appelant.",
    parameters: [project],
    responses: {
      "200": success("ApiMaterialRequestList", "Demandes de l'affaire.", z.object({ items: z.array(listItem), technicians: z.array(technician), canWrite: z.boolean() })),
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
    description: "La demande, son technicien, ses originaux, ses lignes dans l'ordre, le résumé de chaque article rattaché à une ligne (articles, par identifiant), les matières connues du catalogue du tenant et ses fournisseurs actifs.",
    parameters: [project, requestId],
    responses: {
      "200": success("ApiMaterialRequestDetail", "Demande et listes de choix.", z.object({
        ...detailShape, canWrite: z.boolean(), materialOptions: z.array(z.string()),
        // label: what a picker shows, the name with what tells two suppliers of the same name apart (TI-691).
        supplierOptions: z.array(z.object({ id: uuid, name: z.string(), label: z.string() })),
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
    description: "Supprime la demande, ses lignes et ses originaux, octets compris. Refusé tant qu'un bon de commande qui n'est pas annulé porte une de ses lignes (TI-691) : rien n'est supprimé, originaux compris.",
    parameters: [project, requestId],
    responses: {
      "200": success("ApiMaterialRequestDeleted", "Demande supprimée.", deleted), ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_ORDERED : des lignes sont dans un bon de commande qui n'est pas annulé ; l'annuler ou supprimer le brouillon d'abord. details.references."),
    },
  },
  {
    tags, method: "post", path: `${one}/files`, summary: "Préparer le dépôt d'originaux",
    description: `Les photos ne passent pas par l'application : le navigateur les envoie au stockage. Cet appel vérifie ce qui est annoncé (de 1 à ${MATERIAL_REQUEST_MAX_FILES} images JPEG, PNG ou WebP de 20 Mo au plus, nom et type concordants, ${MATERIAL_REQUEST_MAX_FILES} originaux conservés par demande), enregistre une ligne invisible par photo et signe un envoi par photo avec la session de l'appelant, sans écrasement possible. Le navigateur envoie ensuite chaque fichier avec uploadToSignedUrl(path, token, fichier) sur le bucket material-requests, puis appelle files/complete. Un seul fichier refusé refuse le lot. Avec quote_id (TI-691), le lot répond à un devis de cette demande encore demandé ou reçu : PDF ou images, ${MATERIAL_REQUEST_QUOTE_MAX_FILES} fichiers conservés par devis, à part des originaux, listés avec le devis et jamais parmi les originaux ; même chemin de stockage (tenant/affaire/demande/fichier/nom).`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestFilesPrepare", description: "Nom, type déclaré et taille de chaque fichier ; quote_id pour la réponse d'un devis.", schema: prepareMaterialRequestFilesSchema }),
    responses: {
      "201": success("ApiMaterialRequestFilesPrepared", "Un envoi signé par photo, valable deux heures.", uploads),
      ...writeRefusals,
      "404": refusal("NOT_FOUND : affaire, demande ou devis d'ailleurs."),
      "409": quoteReadOnly,
      "413": refusal("PAYLOAD_TOO_LARGE : une photo annoncée dépasse 20 Mo."),
      "422": refusal(`MATERIAL_REQUEST_HEIC_UNSUPPORTED : photo HEIC, à convertir en JPEG avant l'envoi (l'écran le fait). MATERIAL_REQUEST_FILE_LIMIT : la demande garderait plus de 12 originaux. MATERIAL_REQUEST_QUOTE_FILE_LIMIT : le devis garderait plus de ${MATERIAL_REQUEST_QUOTE_MAX_FILES} fichiers. MATERIAL_REQUEST_UPLOADS_PENDING : plus de 24 fichiers attendraient leurs octets sur cette demande.`),
    },
  },
  {
    tags, method: "post", path: `${one}/files/complete`, summary: "Terminer le dépôt d'originaux",
    description: "Vérifie dans le stockage chaque fichier préparé : présent, de la taille annoncée, et dont les premiers octets sont ceux du type annoncé (un PDF commence par %PDF-). Tout ou rien : si une photo échoue, aucune du lot n'est conservée (lignes et octets retirés) ; sinon le lot devient visible en une seule écriture. Un original n'est listé, compté et servi qu'après cet appel. Une photo déjà conservée, nommée à nouveau, est retournée sans être relue.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestFilesComplete", description: "Identifiants reçus à la préparation.", schema: completeMaterialRequestFilesSchema }),
    responses: {
      "200": success("ApiMaterialRequestFilesCompleted", "Originaux conservés, dans l'ordre demandé.", z.object({ files: z.array(file) })),
      ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_UPLOAD_CHANGED : une photo du lot a été annulée entre-temps ; celles déjà visibles le restent, recharger la demande. MATERIAL_REQUEST_QUOTE_READ_ONLY : le devis du lot a été retenu ou clos pendant l'envoi ; le lot est retiré."),
      "422": jsonResponse("MATERIAL_REQUEST_FILE_REJECTED : chaque photo refusée et sa raison (missing, size, type) ; aucune du lot n'est conservée. Même statut, code MATERIAL_REQUEST_FILE_LIMIT, sans details.rejected, quand le lot ferait dépasser 12 originaux (MATERIAL_REQUEST_QUOTE_FILE_LIMIT : les fichiers de son devis) : il est alors écarté en entier.", fileRejected),
    },
  },
  {
    tags, method: "get", path: `${one}/files/{fileId}`, summary: "Lire un original ou le fichier d'un devis",
    description: "Octets de l'image, ou du PDF d'un devis, servis par l'application à qui peut lire l'affaire : aucune URL signée. Réponse privée, non stockable, sans détection de type, avec le type vérifié au dépôt. Une image est servie inline ; le PDF d'un devis, document d'un fournisseur, l'est en pièce jointe (Content-Disposition: attachment), jamais affiché dans l'origine de l'application. Un fichier dont les octets ne sont pas conservés répond 404.",
    parameters: [project, requestId, fileId],
    responses: {
      "200": { description: "Fichier d'origine, jamais réécrit.", contents: MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES.map((contentType) => ({ contentType })) },
      ...readRefusals,
    },
  },
  {
    tags, method: "patch", path: `${one}/files/{fileId}`, summary: "Tourner un original",
    description: "Rotation d'affichage par quarts de tour ; les octets conservés ne changent pas. Le fichier d'un devis retenu ou clos ne tourne plus.",
    parameters: [project, requestId, fileId],
    requestBody: jsonBody({ name: "MaterialRequestFileUpdate", description: "Rotation en degrés.", schema: updateMaterialRequestFileSchema }),
    responses: { "200": success("ApiMaterialRequestFileUpdated", "Rotation enregistrée.", z.object({ file })), ...writeRefusals, "409": quoteReadOnly },
  },
  {
    tags, method: "delete", path: `${one}/files/{fileId}`, summary: "Supprimer un original",
    description: "Retire l'original de toute lecture, puis supprime ses octets et sa ligne. Vaut aussi pour une photo préparée mais pas encore conservée : c'est ainsi qu'un dépôt s'annule, et un envoi encore en cours n'aboutit plus. Le fichier d'un devis se supprime de même tant que le devis est demandé ou reçu ; il reste une fois le devis retenu ou clos.",
    parameters: [project, requestId, fileId],
    responses: { "200": success("ApiMaterialRequestFileDeleted", "Original supprimé.", deleted), ...writeRefusals, "409": quoteReadOnly },
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
    responses: { "200": success("ApiMaterialRequestLinesUpdated", "Lignes de la sélection.", linesData), ...writeRefusals,
      "409": refusal(`${linePriced.description} ${lineOrdered}`) },
  },
  {
    tags, method: "patch", path: `${one}/lines/{lineId}`, summary: "Modifier une ligne",
    description: `Seuls les champs envoyés changent. ${draftRule} Changer le type, la dimension, la matière, la zone ou l'imputation d'une ligne retire son « doublon vu », sauf si la même requête le redonne. Statut, position et validation ne se modifient pas ici.`,
    parameters: [project, requestId, lineId],
    requestBody: jsonBody({ name: "MaterialRequestLineUpdate", description: "Au moins un champ.", schema: updateMaterialRequestLineSchema }),
    responses: { "200": success("ApiMaterialRequestLineUpdated", "Ligne enregistrée.", z.object({ line })), ...writeRefusals,
      "409": refusal(`${linePriced.description} ${lineOrdered}`) },
  },
  {
    tags, method: "delete", path: `${one}/lines/{lineId}`, summary: "Supprimer une ligne",
    description: "Supprime la ligne ; les positions des autres lignes ne changent pas. Une ligne qu'un devis retenu a chiffrée ne se supprime plus seule.",
    parameters: [project, requestId, lineId],
    responses: { "200": success("ApiMaterialRequestLineDeleted", "Ligne supprimée.", deleted), ...writeRefusals, "409": linePriced },
  },
  {
    tags, method: "get", path: `${one}/quotes`, summary: "Lister les devis d'une demande",
    description: "Toutes les consultations de la demande, closes et retenue comprises, la plus récente d'abord (requested_at) : fournisseur, variante (with_references), message tel que copié, dates, total HT et notes, lignes demandées dans l'ordre de la demande avec leur prix unitaire HT en centimes (null tant qu'il n'est pas chiffré), fichiers de la réponse.",
    parameters: [project, requestId],
    responses: { "200": success("ApiMaterialRequestQuotes", "Devis de la demande.", z.object({ items: z.array(quote) })), ...readRefusals },
  },
  {
    tags, method: "post", path: `${one}/quotes`, summary: "Enregistrer la consultation d'un fournisseur",
    description: `Le bureau consulte un fournisseur par un message qu'il copie dans WhatsApp (MergeOne n'envoie rien) : avec les références pour le fournisseur habituel, sans elles et avec les désignations complètes pour mettre des fournisseurs en concurrence. Le devis est enregistré « demandé » avec ses lignes (1 à ${MATERIAL_REQUEST_MAX_LINES} lignes de cette demande, chacune une fois ; elles ne changent plus ensuite), en une seule écriture, tout ou rien. Un fournisseur n'a qu'un devis demandé ou reçu à la fois par demande ; une fois son devis retenu ou clos, il peut être consulté à nouveau.`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestQuoteCreate", description: `Fournisseur actif du tenant, lignes, variante et message copié (${MATERIAL_REQUEST_QUOTE_MESSAGE_MAX} caractères au plus).`, schema: createQuoteSchema }),
    responses: {
      "201": success("ApiMaterialRequestQuoteCreated", "Devis demandé.", z.object({ item: quote })),
      ...writeRefusals,
      "400": refusal("BAD_REQUEST : fournisseur archivé. VALIDATION_ERROR : aucune ligne, ligne nommée deux fois, message vide ou trop long."),
      "404": refusal("NOT_FOUND : affaire ou demande d'ailleurs, ligne d'une autre demande, fournisseur d'un autre tenant."),
      "409": refusal(`MATERIAL_REQUEST_QUOTE_SUPPLIER_OPEN : ce fournisseur a déjà un devis demandé ou reçu pour cette demande ; rien n'est écrit. ${quoteBusy}`),
      "422": refusal("MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED : une ligne a déjà un devis retenu (details : positions, line_ids) ; rien n'est écrit."),
    },
  },
  {
    tags, method: "patch", path: `${one}/quotes/{quoteId}`, summary: "Chiffrer un devis",
    description: "Prix HT des lignes du devis, total HT et notes, en centimes entiers, tant que le devis est demandé ou reçu ; received: true le marque reçu (daté par la base). Le prix d'une ligne vaut pour price_per unités (1, 10, 100 ou 1 000 ; 1 par défaut) : une vis à 0,034 € s'écrit 340 centimes pour 100 ; price_per omis garde celui de la ligne. Le montant d'une ligne, quantité × prix / price_per arrondi au centime (demi loin de zéro), n'est pas calculé ici. Seuls les champs envoyés changent, null efface ; une seule écriture, tout ou rien.",
    parameters: [project, requestId, quoteId],
    requestBody: jsonBody({ name: "MaterialRequestQuoteUpdate", description: "Au moins un champ.", schema: updateQuoteSchema }),
    responses: {
      "200": success("ApiMaterialRequestQuoteUpdated", "Devis enregistré.", z.object({ item: quote })),
      ...writeRefusals,
      "404": refusal("NOT_FOUND : devis d'une autre demande, ou ligne que le devis ne demande pas (details : positions, line_ids)."),
      "409": refusal(`MATERIAL_REQUEST_QUOTE_READ_ONLY : le devis est retenu ou clos ; il ne se modifie plus, ses fichiers compris. ${quoteBusy}`),
    },
  },
  {
    tags, method: "post", path: `${one}/quotes/{quoteId}/retain`, summary: "Retenir un devis",
    description: "Un seul devis retenu par ligne. En une transaction : le devis reçu, toutes ses lignes chiffrées et validées (retenir fige ce qu'elles commandent ; un devis peut être demandé et chiffré pour des lignes en brouillon), devient « retenu » (daté et signé par la base) ; ses lignes prennent son fournisseur, leur prix HT, la quantité pour laquelle il vaut et son identifiant (unit_price_ht_cents, price_per, price_quote_id), une ligne validée le restant ; une ligne d'affaire sans matière propre, consultée dans la matière présumée de la demande, reçoit cette matière (qui doit être confirmée), une ligne de frais généraux n'est pas touchée ; ce qu'elles commandent ne change plus ensuite (aucun retour dans cette livraison) ; chaque autre devis demandé ou reçu de la demande qui partage une ligne avec lui est clos (closed_quote_ids) et reste lisible. Le coût imputé ensuite est ce prix, jamais un prix du catalogue. Un devis retenu ne se rouvre pas.",
    parameters: [project, requestId, quoteId],
    responses: {
      "200": success("ApiMaterialRequestQuoteRetained", "Devis retenu, ses lignes et les devis clos.", quoteRetained),
      ...writeRefusals,
      "404": refusal("NOT_FOUND : devis d'une autre demande."),
      "409": refusal(`MATERIAL_REQUEST_QUOTE_READ_ONLY : le devis est déjà retenu ou clos. ${quoteBusy}`),
      "422": refusal("MATERIAL_REQUEST_QUOTE_NOT_RECEIVED : le devis n'est pas encore reçu. MATERIAL_REQUEST_QUOTE_LINES_UNPRICED : des lignes n'ont pas de prix (details : positions, line_ids). MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED : une ligne a déjà un devis retenu. MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED : des lignes ne sont pas validées (details : positions, line_ids). MATERIAL_REQUEST_QUOTE_WITHOUT_LINES : le devis ne demande plus aucune ligne. MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED : des lignes sans matière propre et la matière présumée de la demande n'est pas confirmée (details : positions, line_ids). Rien n'est écrit."),
    },
  },
  {
    tags, method: "get", path: `${one}/orders`, summary: "Situation des commandes d'une demande",
    description: "Pour les lecteurs de la demande (propriétaire de l'affaire, administrateur, directeur), dans l'ordre de la demande : les lignes prêtes à commander (validées, chiffrées par un devis retenu, dans aucun bon de commande non annulé), les autres avec la première chose qui leur manque (not_validated, no_supplier, not_priced ; le libellé est celui de l'écran), les lignes commandées avec leur bon et son statut, et chaque bon portant une ligne de la demande, annulés compris, du plus ancien au plus récent : référence, fournisseur, statut, total HT du bon, nombre de lignes de la demande qu'il porte. can_create dit si l'appelant peut créer les brouillons (il écrit la demande et peut commander : rôle admin ou engineer). Les bons sont décrits même quand l'appelant ne peut pas les ouvrir (un bon n'est lisible que par son auteur et les administrateurs).",
    parameters: [project, requestId],
    responses: { "200": success("ApiMaterialRequestOrders", "Situation des lignes et bons de la demande.", ordersSummary), ...readRefusals },
  },
  {
    tags, method: "get", path: "/api/affaires/{projectId}/supply-cost", summary: "Coût des fournitures d'une affaire",
    description: "Pour les lecteurs de l'affaire (propriétaire, administrateur, directeur), par type de fourniture, puis « non classé » (lignes sans type de fourniture ou sans article) et le port et les remises : le budget fournitures de la version acceptée par le client et le coût de ses bons de commande. budget_version : la version acceptée qui fait le budget (la plus haute si plusieurs, accepted_count dit combien), quelle que soit sa variante ; null quand aucune version n'est acceptée, et alors chaque budget_cents est null (pas de budget). Budget d'une ligne chiffrée : quantité × prix d'achat FO × provision FO × K FO (moteur 3 ; quantité × prix × K FO avant), arrondi au centime par ligne ; une ligne non chiffrée compte 0. ordered_cents : bons confirmés ou reçus de l'affaire, au prix réel ; pending_cents : brouillons et bons envoyés, au prix du devis retenu ; bons annulés et frais généraux exclus ; une remise compte en négatif. not_counted.estimate_orders : bons créés depuis un devis de l'affaire, quel que soit leur statut sauf annulé ; ils ne portent pas l'affaire et ne sont pas comptés. Une affaire archivée n'est pas trouvée (404). Montants en centimes.",
    parameters: [project],
    responses: { "200": success("ApiAffaireSupplyCost", "Budget et commandé par type de fourniture.", affaireSupplyCostSchema), ...readRefusals },
  },
  {
    tags, method: "post", path: `${one}/orders`, summary: "Créer les brouillons de commande d'une demande",
    description: "Un brouillon de bon de commande par fournisseur à partir des lignes prêtes, en une transaction : tous de l'affaire de la demande, sans chantier, avec le lieu de livraison de la demande (delivery_mode : site, office, counter) et une note qui la nomme ; les lignes en frais généraux suivent dans le brouillon de leur fournisseur, imputées aux frais généraux. Chaque ligne : article, référence chez ce fournisseur (sinon celle de l'article), libellé catalogue de la ligne, quantité, unité, prix HT et lot du devis retenu (jamais un prix du catalogue), TVA 20 %, type de fourniture, imputation, ligne de la demande. Montant d'une ligne : quantité × prix ÷ lot, arrondi au centime le plus proche, la moitié s'éloignant de zéro. Une ligne n'est commandée qu'une fois parmi les bons non annulés ; annuler son bon la rend de nouveau prête. La même clé renvoie les mêmes brouillons (200, replayed, chaque bon avec son statut actuel) et ne crée rien ; une nouvelle clé par clic.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestOrdersCreate", description: "Clé d'idempotence (UUID).", schema: createMaterialRequestOrdersSchema }),
    responses: {
      "201": success("ApiMaterialRequestOrdersCreated", "Brouillons créés, un par fournisseur (status draft).", ordersCreated),
      "200": success("ApiMaterialRequestOrdersReplayed", "Même clé : les brouillons déjà créés, replayed vrai.", ordersCreated),
      ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_LINE_ALREADY_ORDERED : une ligne vient d'être commandée par ailleurs. MATERIAL_REQUEST_ORDER_KEY_TAKEN : la clé a servi à un autre membre. MATERIAL_REQUEST_ORDER_BUSY : une autre écriture était en cours, réessayer. Rien n'est créé."),
      "422": refusal("MATERIAL_REQUEST_ORDER_NOTHING_READY : aucune ligne prête. MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE : le fournisseur de lignes prêtes est archivé (details.supplier_names). Rien n'est créé."),
    },
  },
  {
    tags, method: "post", path: `${one}/quotes/{quoteId}/close`, summary: "Clore un devis",
    description: "Clôt à la main un devis demandé ou reçu (daté par la base) ; il reste lisible et libère le fournisseur pour une nouvelle consultation. Un devis déjà clos est retourné tel quel.",
    parameters: [project, requestId, quoteId],
    responses: {
      "200": success("ApiMaterialRequestQuoteClosed", "Devis clos.", z.object({ item: quote })),
      ...writeRefusals,
      "404": refusal("NOT_FOUND : devis d'une autre demande."),
      "409": quoteReadOnly,
    },
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
    tags, method: "post", path: `${one}/lines/replace`, summary: "Redécouper le message : remplacer les lignes en brouillon",
    description: `Remplace toutes les lignes de la demande, que l'écran nomme dans replaced_ids, par les lignes lues à nouveau dans le message, en brouillon à partir de la position 1 ; la réponse donne toutes les lignes de la demande ensuite. Refusé sans rien écrire si les lignes ne sont plus celles nommées (une autre session en a ajouté ou supprimé), ou si l'une est validée, chiffrée par un devis retenu ou demandée dans un devis. Deux écritures : la suppression des brouillons, puis l'ajout ; si l'ajout échoue, la demande reste sans ligne avec son message, qui se redécoupe. ${MATERIAL_REQUEST_MAX_LINES} lignes au plus de part et d'autre.`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesReplace", description: "Lignes remplacées et lignes nouvelles.", schema: replaceMaterialRequestLinesSchema }),
    responses: {
      "200": success("ApiMaterialRequestLinesReplaced", "Toutes les lignes de la demande, dans l'ordre.", linesData),
      ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_LINES_CHANGED : les lignes ont changé entre-temps ; recharger la demande. MATERIAL_REQUEST_LINES_KEPT : une ligne est validée, ou dans un devis ou un bon de commande ; rien n'est remplacé."),
      "422": refusal(`MATERIAL_REQUEST_LINE_LIMIT : la demande dépasserait ${MATERIAL_REQUEST_MAX_LINES} lignes.`),
    },
  },
  {
    tags, method: "post", path: `${one}/lines/reopen`, summary: "Rouvrir des lignes validées",
    description: "Ramène en brouillon les lignes désignées ; auteur et date de validation sont effacés. Une ligne chiffrée par un devis retenu se rouvre et se revalide de même : son prix et ce qu'elle commande ne changent pas.",
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesReopen", description: "Lignes à rouvrir.", schema: materialRequestLineIdsSchema }),
    responses: { "200": success("ApiMaterialRequestLinesReopened", "Lignes désignées, en brouillon.", linesData), ...writeRefusals,
      "409": refusal(lineOrdered) },
  },
  {
    tags, method: "post", path: `${one}/lines/retain-suppliers`, summary: "Retenir le fournisseur de plusieurs lignes",
    description: `Écrit, en une seule opération, tout ou rien, le fournisseur choisi de chaque ligne désignée qui n'en a pas encore, et seulement d'elle (un choix refusé n'en écrit aucun) : une ligne à laquelle une autre session a donné un fournisseur entre-temps garde le sien. Une ligne d'une autre demande n'est pas écrite. Les lignes non écrites sont listées dans skipped. Les fournisseurs appartiennent au tenant actif ; ${MATERIAL_REQUEST_MAX_LINES} lignes au plus, chacune nommée une fois. Le fournisseur n'est pas ce que dit la ligne : une ligne validée le reste.`,
    parameters: [project, requestId],
    requestBody: jsonBody({ name: "MaterialRequestLinesRetainSuppliers", description: "Ligne et fournisseur retenu pour elle.", schema: retainLineSuppliersSchema }),
    responses: {
      "200": success("ApiMaterialRequestLinesSuppliersRetained", "Lignes écrites, dans l'ordre de la demande, et lignes laissées telles quelles.", retainedSuppliers),
      ...writeRefusals,
      "400": refusal("BAD_REQUEST : fournisseur d'un autre tenant, ligne nommée deux fois, ou lot vide ou trop grand ; rien n'est écrit."),
    },
  },
  {
    tags, method: "get", path: `${one}/candidates`, summary: "Proposer des articles pour les lignes d'une demande",
    description: "Pour chaque ligne sans article (brouillon ou validée), jusqu'à cinq articles actifs du catalogue du tenant, brouillons compris : par référence (interne ou fournisseur), puis par nom usuel appris, puis par proximité du type, de la matière et de la dimension. La matière de la ligne, sinon la matière présumée de la demande (confirmée ou non ; hors frais généraux), guide les propositions. Rien n'est rattaché sans le geste du bureau.",
    parameters: [project, requestId],
    responses: {
      "200": success("ApiMaterialRequestCandidates", "Propositions par identifiant de ligne ; une ligne sans proposition a une liste vide.", z.object({ lines: z.record(z.string(), z.array(candidate)) })),
      ...readRefusals,
    },
  },
  {
    tags, method: "get", path: `${one}/lines/{lineId}/candidates`, summary: "Chercher des articles pour une ligne",
    description: "Propositions pour une ligne, rattachée ou non. q remplace, le temps de la recherche, les mots du type de la ligne ; sa dimension, sa matière et sa référence guident toujours la recherche. Avec q, un article d'une autre dimension, matière ou angle est aussi proposé, avec un avertissement, après ceux qui concordent. Un q vide équivaut à son absence.",
    parameters: [
      project, requestId, lineId,
      queryParameter({ name: "q", description: "Mots cherchés à la main (200 caractères au plus).", schemaName: "MaterialRequestLineCandidatesQuery", schema: z.string().min(1).max(200) }),
    ],
    responses: {
      "200": success("ApiMaterialRequestLineCandidates", "Propositions, la plus sûre d'abord.", z.object({ candidates: z.array(candidate).max(10) })),
      ...readRefusals,
    },
  },
  {
    tags, method: "put", path: `${one}/lines/{lineId}/article`, summary: "Rattacher une ligne à un article",
    description: `Le libellé du catalogue devient celui de la ligne : type, matière, précision (nuance et norme), dimension et unité viennent de l'article ; une colonne vide de l'article garde la valeur de la ligne. Une dimension donnée par l'article décoche « sans dimension ». Une autre unité que celle de la ligne marque la quantité à vérifier (quantity_doubtful). Les mots du technicien (original_text, rempli à partir d'eux s'il était vide) et sa référence restent. Le libellé de la ligne avant son premier rattachement est conservé côté serveur. Avec learn_alias à true seulement (choix du bureau au rattachement ; absent vaut non), ses mots de type deviennent un nom usuel de l'article pour tout le tenant, sauf s'ils disent déjà son type ou sa désignation, y compris lors d'un nouveau rattachement ; le rattachement tient même si ce nom ne peut être enregistré. ${articleRule}`,
    parameters: [project, requestId, lineId],
    requestBody: jsonBody({ name: "MaterialRequestLineArticleLink", description: "Article actif du tenant et voie par laquelle il a été choisi.", schema: linkMaterialRequestLineArticleSchema }),
    responses: {
      "200": success("ApiMaterialRequestLineArticleLinked", "Ligne rattachée, article et nom usuel appris (null si rien de nouveau).", articleResult),
      ...writeRefusals,
      "404": refusal("NOT_FOUND : affaire, demande ou ligne d'ailleurs, ou article absent, archivé ou d'un autre tenant."),
      "409": refusal("MATERIAL_REQUEST_LINE_CHANGED : la ligne a changé entre-temps (autre session) ; rien n'est écrit, recharger la demande. MATERIAL_REQUEST_LINE_PRICED : la ligne a un devis retenu, son article ne change plus."),
    },
  },
  {
    tags, method: "post", path: `${one}/lines/{lineId}/article`, summary: "Créer l'article d'une ligne et l'y rattacher",
    description: `Crée l'article en brouillon du catalogue, marqué comme créé depuis une demande (le catalogue l'affiche « Nouveau » jusqu'à sa validation), avec un type de fourniture obligatoire ; la désignation vaut par défaut type, matière et dimension. Réservé à qui peut ajouter des articles (TI-689 : administrateurs et ingénieurs). Puis rattache la ligne comme PUT, voie « created », et n'apprend un nom usuel qu'avec learn_alias à true. ${articleRule}`,
    parameters: [project, requestId, lineId],
    requestBody: jsonBody({ name: "MaterialRequestLineArticleCreate", description: "Article à créer.", schema: createMaterialRequestLineArticleSchema }),
    responses: {
      "201": success("ApiMaterialRequestLineArticleCreated", "Article créé et ligne rattachée.", articleResult),
      ...writeRefusals,
      "400": refusal("BAD_REQUEST : type de fourniture absent du référentiel du tenant."),
      "409": refusal("CONFLICT : « Cette référence interne existe déjà. Choisissez une autre référence ou laissez le champ vide. » MATERIAL_REQUEST_LINE_CHANGED : la ligne a changé entre-temps ; l'article créé est retiré. MATERIAL_REQUEST_LINE_PRICED : la ligne a un devis retenu ; rien n'est créé."),
    },
  },
  {
    tags, method: "delete", path: `${one}/lines/{lineId}/article`, summary: "Détacher l'article d'une ligne",
    description: `La ligne retrouve le libellé qu'elle avait avant son premier rattachement (les propositions sont recalculées sur lui) ; une ligne rattachée sans libellé conservé garde ses colonnes. ${articleRule}`,
    parameters: [project, requestId, lineId],
    responses: {
      "200": success("ApiMaterialRequestLineArticleUnlinked", "Ligne sans article.", z.object({ line })),
      ...writeRefusals,
      "409": refusal("MATERIAL_REQUEST_LINE_CHANGED : la ligne a changé entre-temps (autre session) ; rien n'est écrit, recharger la demande. MATERIAL_REQUEST_LINE_PRICED : la ligne a un devis retenu, son article ne change plus."),
    },
  },
  {
    tags, method: "get", path: `${one}/supplier-proposals`, summary: "Proposer un fournisseur pour les lignes d'une demande",
    description: "Pour chaque ligne qui a un article et pas encore de fournisseur, le premier fournisseur actif du tenant parmi, dans cet ordre : celui que le technicien a nommé (fournisseur présumé de la demande, confirmé ou non), l'exception de l'article, le fournisseur préféré de son type de fourniture, celui de la dernière commande confirmée ou reçue de l'article. Une source dont le fournisseur est archivé ou a été retiré de l'article (sa référence chez lui est inactive) est passée. Null quand aucune source n'en donne. confirmed est faux pour le fournisseur nommé par le technicien tant que la demande ne l'a pas confirmé (à confirmer), vrai sinon. supplier_sku et product_url sont la référence et l'adresse de l'article chez ce fournisseur si elle est active. references donne de même, pour chaque ligne qui a déjà un article et un fournisseur, la référence active de l'article chez ce fournisseur. Rien n'est écrit : le bureau choisit le fournisseur de la ligne par la modification d'une ligne, ou retient plusieurs propositions par lines/retain-suppliers, et peut toujours le changer ; une ligne validée le reste.",
    parameters: [project, requestId],
    responses: {
      "200": success("ApiMaterialRequestSupplierProposals", "Proposition par identifiant de ligne (null : aucune source) et référence des lignes qui ont un fournisseur.", supplierProposals),
      ...readRefusals,
    },
  },
  {
    tags: ["Catalogue"], method: "get", path: "/api/products/{productId}/supplier-items", summary: "Lister les fournisseurs d'un article",
    description: "Fournisseurs de l'article avec sa référence et son adresse chez chacun, actifs d'abord puis par nom ; has_price dit si un prix du tarif utilise cette référence ; preferred_supplier_id est l'exception de l'article (null sans exception). Lisible par tout membre du tenant actif.",
    parameters: [productId],
    responses: {
      "200": success("ApiArticleSupplierItems", "Fournisseurs de l'article et son exception.", articleSuppliers),
      "404": refusal("NOT_FOUND : article d'un autre tenant ou inconnu."),
    },
  },
  {
    tags: ["Catalogue"], method: "put", path: "/api/products/{productId}/supplier-items", summary: "Enregistrer la référence d'un article chez un fournisseur",
    description: "Ajoute ou modifie, sans prix, la référence (1 à 255 caractères, espaces retirés) et l'adresse http(s) (2 000 caractères au plus) de l'article chez le fournisseur. Clé par clé : omise, la valeur enregistrée est gardée ; null (ou vide) l'efface. Une référence active garde une référence ou une adresse : un nouveau fournisseur en demande une, et l'enregistrement ne peut effacer la dernière. is_active vaut true s'il est omis ; false retire ce fournisseur de l'article sans rien supprimer ni demander de référence (une référence qui ne porte que des prix se retire telle quelle), et retire aussi l'exception de l'article si elle désigne ce fournisseur. Les prix restent enregistrés mais ne sont plus proposés tant que le fournisseur est retiré de l’article ; enregistrer un prix le rétablit. Droits : ceux de la modification de l'article.",
    parameters: [productId],
    requestBody: jsonBody({ name: "ArticleSupplierItemSave", description: "Fournisseur du tenant et référence chez lui.", schema: saveArticleSupplierItemSchema }),
    responses: {
      "200": success("ApiArticleSupplierItemSaved", "Référence enregistrée et exception de l'article après l'enregistrement.", articleSupplierSaved),
      ...catalogueEditorRefusals,
    },
  },
  {
    tags: ["Catalogue"], method: "patch", path: "/api/products/{productId}/preferred-supplier", summary: "Choisir le fournisseur de l'article",
    description: "Exception de l'article : proposée aux lignes de demandes de matériel avant le fournisseur préféré de son type de fourniture. Le fournisseur doit avoir une référence active pour l'article. null la retire. Droits : ceux de la modification de l'article.",
    parameters: [productId],
    requestBody: jsonBody({ name: "ProductPreferredSupplier", description: "Fournisseur du tenant, ou null.", schema: productPreferredSupplierSchema }),
    responses: {
      "200": success("ApiProductPreferredSupplier", "Exception enregistrée.", z.object({ preferred_supplier_id: uuid.nullable() })),
      ...catalogueEditorRefusals,
      "422": refusal("PRODUCT_PREFERRED_SUPPLIER_ITEM_REQUIRED : ce fournisseur n'a pas de référence active pour l'article (aucune, ou retirée) ; rien n'est écrit."),
    },
  },
  {
    tags: ["Catalogue"], method: "patch", path: "/api/catalogue/supply-types/{supplyTypeId}", summary: "Choisir le fournisseur préféré d'un type de fourniture",
    description: "Fournisseur proposé aux lignes de demandes de matériel dont l'article est de ce type, sauf exception de l'article. null le retire. Réservé aux administrateurs et aux ingénieurs du tenant actif.",
    parameters: [supplyTypeId],
    requestBody: jsonBody({ name: "SupplyTypePreferredSupplier", description: "Fournisseur du tenant, ou null.", schema: supplyTypePreferredSupplierSchema }),
    responses: {
      "200": success("ApiSupplyTypePreferredSupplier", "Type de fourniture et son fournisseur préféré.", z.object({ item: supplyTypeItem })),
      "403": refusal("FORBIDDEN : réservé aux administrateurs et aux ingénieurs."),
      "404": refusal("NOT_FOUND : type de fourniture ou fournisseur d'un autre tenant, ou inconnu."),
    },
  },
  {
    tags: ["Catalogue"], method: "get", path: "/api/products/{productId}/aliases", summary: "Lister les noms usuels d'un article",
    description: "Noms appris par le bureau en rattachant des lignes de demandes de matériel, du plus ancien au plus récent. Lisible par tout membre du tenant actif.",
    parameters: [productId],
    responses: {
      "200": success("ApiProductAliases", "Noms usuels de l'article.", z.object({ items: z.array(z.object({ id: uuid, alias: z.string(), created_at: timestamp })) })),
      "404": refusal("NOT_FOUND : article d'un autre tenant ou inconnu."),
    },
  },
  {
    tags: ["Catalogue"], method: "delete", path: "/api/products/{productId}/aliases/{aliasId}", summary: "Retirer un nom usuel d'un article",
    description: "Un administrateur retire tout nom usuel ; un autre membre, ceux qu'il a appris.",
    parameters: [productId, aliasId],
    responses: {
      "200": success("ApiProductAliasDeleted", "Nom usuel retiré.", deleted),
      "403": refusal("FORBIDDEN : ni administrateur, ni auteur du nom usuel."),
      "404": refusal("NOT_FOUND : article ou nom usuel d'un autre tenant, ou d'un autre article."),
    },
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
  {
    tags: lifecycleTags, method: "post", path: "/api/purchase-orders/{id}/confirmation", summary: "Confirmer la commande d'un brouillon d'affaire",
    description: "Enregistre qu'un brouillon de bon de commande d'une affaire a été passé : le prix réel et le lot des lignes données (les autres gardent le leur), la date de commande (aujourd'hui au plus tard, heure de Paris), la livraison annoncée (pas avant la commande ; absente, la date du brouillon reste, et elle non plus ne précède pas la commande, sauf « TBD »), la référence du fournisseur et la preuve, un document déjà joint au bon (POST /api/purchase-orders/{id}/devis). Le brouillon devient confirmé ; ses lignes et son en-tête sont alors figés. Montant d'une ligne : quantité × prix ÷ lot, arrondi au centime le plus proche, la moitié s'éloignant de zéro. Dans un brouillon, le prix d'une ligne de demande ne change qu'ici.",
    parameters: [purchaseOrderId],
    requestBody: jsonBody({ name: "PurchaseOrderConfirmation", description: "Révision lue, dates, référence, preuve et prix réels.", schema: confirmPurchaseOrderSchema }),
    responses: {
      "200": success("ApiPurchaseOrderConfirmed", "Bon confirmé, avec ses totaux au prix réel.", orderConfirmed),
      "403": lifecycleRights,
      "404": lifecycleNotFound,
      "409": refusal("PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT : le bon n'est plus un brouillon. PURCHASE_ORDER_REVISION_CONFLICT : le bon a changé depuis sa lecture. PURCHASE_ORDER_ITEMS_INVALID : une ligne n'est pas de ce bon ou est donnée deux fois. Rien n'est écrit."),
      "422": refusal("PURCHASE_ORDER_AFFAIRE_ONLY : bon sans affaire. PURCHASE_ORDER_CONFIRMATION_DATE_INVALID : commande dans le futur ou livraison avant la commande. PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED : aucun document de ce bon. PURCHASE_ORDER_CONFIRMATION_EMPTY : aucun article. PURCHASE_ORDER_TOTAL_NEGATIVE : les remises dépassent les articles. PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE : montant hors capacité. Rien n'est écrit."),
    },
  },
  {
    tags: lifecycleTags, method: "post", path: "/api/purchase-orders/{id}/reception", summary: "Enregistrer la réception d'un bon d'affaire",
    description: "Enregistre la réception d'un bon d'affaire confirmé, en entier : sa date, entre la date de commande et aujourd'hui (heure de Paris), et une note libre pour ce qui reste à venir. Le bon devient reçu. Une fois commandé, un bon d'affaire n'est plus ni annulé ni supprimé.",
    parameters: [purchaseOrderId],
    requestBody: jsonBody({ name: "PurchaseOrderReception", description: "Révision lue, date de réception et note.", schema: receivePurchaseOrderSchema }),
    responses: {
      "200": success("ApiPurchaseOrderReceived", "Bon reçu.", orderReceived),
      "403": lifecycleRights,
      "404": lifecycleNotFound,
      "409": refusal("PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED : seul un bon confirmé est reçu. PURCHASE_ORDER_REVISION_CONFLICT : le bon a changé depuis sa lecture. Rien n'est écrit."),
      "422": refusal("PURCHASE_ORDER_AFFAIRE_ONLY : bon sans affaire. PURCHASE_ORDER_RECEPTION_DATE_INVALID : réception avant la commande ou dans le futur. Rien n'est écrit."),
    },
  },
];
