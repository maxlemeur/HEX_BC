import { z, type ZodTypeAny } from "zod";

import {
  batchOperationsSchema,
  bulkUpdateEstimateItemsRequestSchema,
  createEstimateAssemblySchema,
  createEstimateCategorySchema,
  createEstimateItemSchema,
  createEstimateSchema,
  createEstimateTemplateFromVersionSchema,
  createEstimateVariantSchema,
  createLaborRoleSchema,
  createSuggestionRuleSchema,
  deleteEstimateItemSchema,
  duplicateEstimateTemplateSchema,
  estimateSupplierComparisonsRequestSchema,
  instantiateEstimateFromTemplateSchema,
  listEstimateAssembliesQuerySchema,
  listEstimateTemplatesQuerySchema,
  patchEstimateStatusSchema,
  patchEstimateVersionSchema,
  promoteEstimateVariantSchema,
  reorderEstimateItemsSchema,
  suggestionRuleFeedbackSchema,
  updateEstimateAssemblySchema,
  updateEstimateItemSchema,
  updateEstimateTemplateSchema,
  updateLaborRoleSchema,
  updateSuggestionRuleSchema,
} from "@/lib/estimates/schemas";

export type OpenApiHttpMethod = "get" | "post" | "patch" | "delete";
export type OpenApiSchemaIO = "input" | "output";
export type OpenApiContentType =
  | "application/json"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type OpenApiSchemaDefinition = {
  schemaName: string;
  schema: ZodTypeAny;
  io?: OpenApiSchemaIO;
};

export type OpenApiParameterDefinition = OpenApiSchemaDefinition & {
  in: "path" | "query" | "header";
  name: string;
  description: string;
  required?: boolean;
};

export type OpenApiRequestBodyDefinition = OpenApiSchemaDefinition & {
  required?: boolean;
  description?: string;
  contentType?: "application/json";
};

export type OpenApiResponseHeaderDefinition = OpenApiSchemaDefinition & {
  name: string;
  description: string;
  required?: boolean;
};

export type OpenApiResponseContentDefinition = {
  contentType: OpenApiContentType;
  schema?: OpenApiSchemaDefinition;
};

export type OpenApiResponseDefinition = {
  description: string;
  contents?: OpenApiResponseContentDefinition[];
  headers?: OpenApiResponseHeaderDefinition[];
};

export type OpenApiOperationDefinition = {
  method: OpenApiHttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters?: OpenApiParameterDefinition[];
  requestBody?: OpenApiRequestBodyDefinition;
  responses: Record<string, OpenApiResponseDefinition>;
};

function schemaDefinition(
  name: string,
  schema: ZodTypeAny,
  io: OpenApiSchemaIO = "input"
): OpenApiSchemaDefinition {
  return {
    schemaName: name,
    schema,
    io,
  };
}

function pathParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
}): OpenApiParameterDefinition {
  return {
    in: "path",
    name: input.name,
    description: input.description,
    required: true,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

function queryParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiParameterDefinition {
  return {
    in: "query",
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

function headerParameter(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiParameterDefinition {
  return {
    in: "header",
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "input"),
  };
}

function responseHeader(input: {
  name: string;
  description: string;
  schemaName: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiResponseHeaderDefinition {
  return {
    name: input.name,
    description: input.description,
    required: input.required ?? false,
    ...schemaDefinition(input.schemaName, input.schema, "output"),
  };
}

function jsonBody(input: {
  name: string;
  description: string;
  schema: ZodTypeAny;
  required?: boolean;
}): OpenApiRequestBodyDefinition {
  return {
    contentType: "application/json",
    required: input.required ?? true,
    description: input.description,
    ...schemaDefinition(input.name, input.schema, "input"),
  };
}

function jsonResponse(
  description: string,
  schema: OpenApiSchemaDefinition = schemaDefinition(
    "ApiSuccessUnknown",
    z.object({
      ok: z.literal(true),
      data: z.unknown(),
    }),
    "output"
  )
): OpenApiResponseDefinition {
  return {
    description,
    contents: [
      {
        contentType: "application/json",
        schema,
      },
    ],
  };
}

const uuidSchema = z.string().uuid("Identifiant invalide.");
const ifMatchHeaderSchema = z.string().trim().min(1, "Jeton de concurrence invalide.");
const forceQuerySchema = z.enum(["0", "1", "true", "false"]);
const dryRunQuerySchema = z.enum(["0", "1", "true", "false"]);
const suggestPricesQuerySchema = z
  .string()
  .trim()
  .min(2, "Le parametre q doit contenir au moins 2 caracteres.");
const changelogFormatQuerySchema = z.enum(["json", "pdf"]);
const pdfFormatQuerySchema = z.enum(["json"]);
const exportFormatQuerySchema = z.enum(["xlsx"]);

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const apiFailureResponseSchema = z.object({
  ok: z.literal(false),
  error: apiErrorSchema,
});

export const apiSuccessUnknownSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

const outlierFlagSchema = z.enum(["price_outlier", "quantity_outlier"]);

const outlierStateSchema = z.object({
  dismissed_by_item_id: z.record(z.string(), z.array(outlierFlagSchema)),
});

const toggleOutlierDismissSchema = z.object({
  item_id: uuidSchema,
  flag_key: outlierFlagSchema,
  dismissed: z.boolean(),
});

export const apiOutlierStateResponseSchema = z.object({
  ok: z.literal(true),
  data: outlierStateSchema,
});

const pdfStatusSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("missing"),
  }),
  z.object({
    status: z.literal("processing"),
    last_error: z.string().optional(),
  }),
  z.object({
    status: z.literal("failed"),
    last_error: z.string().optional(),
  }),
  z.object({
    status: z.literal("ready"),
    download_url: z.string().url(),
    file_path: z.string(),
    sha256_hash: z.string().optional(),
    generated_at: z.string().optional(),
    file_size_bytes: z.number().int().min(0).optional(),
  }),
]);

export const apiPdfStatusResponseSchema = z.object({
  ok: z.literal(true),
  data: pdfStatusSchema,
});

const insertAssemblyIntoVersionBodySchema = z.object({
  after_item_id: z.union([uuidSchema, z.null()]).optional(),
});

export const openApiSharedSchemaDefinitions = {
  apiError: schemaDefinition("ApiError", apiErrorSchema, "output"),
  apiFailureResponse: schemaDefinition(
    "ApiFailureResponse",
    apiFailureResponseSchema,
    "output"
  ),
  apiSuccessUnknown: schemaDefinition(
    "ApiSuccessUnknown",
    apiSuccessUnknownSchema,
    "output"
  ),
  apiOutlierStateResponse: schemaDefinition(
    "ApiOutlierStateResponse",
    apiOutlierStateResponseSchema,
    "output"
  ),
  apiPdfStatusResponse: schemaDefinition(
    "ApiPdfStatusResponse",
    apiPdfStatusResponseSchema,
    "output"
  ),
};

const versionIdPathParameter = pathParameter({
  name: "versionId",
  description: "Identifiant UUID de la version de chiffrage.",
  schemaName: "VersionIdPathParameter",
  schema: uuidSchema,
});

const roleIdPathParameter = pathParameter({
  name: "roleId",
  description: "Identifiant UUID du role de main d'oeuvre.",
  schemaName: "RoleIdPathParameter",
  schema: uuidSchema,
});

const ruleIdPathParameter = pathParameter({
  name: "ruleId",
  description: "Identifiant UUID de la regle de suggestion.",
  schemaName: "RuleIdPathParameter",
  schema: uuidSchema,
});

const templateIdPathParameter = pathParameter({
  name: "templateId",
  description: "Identifiant UUID du template de chiffrage.",
  schemaName: "TemplateIdPathParameter",
  schema: uuidSchema,
});

const assemblyIdPathParameter = pathParameter({
  name: "assemblyId",
  description: "Identifiant UUID de l'assemblage.",
  schemaName: "AssemblyIdPathParameter",
  schema: uuidSchema,
});

const ifMatchHeaderOptionalParameter = headerParameter({
  name: "if-match",
  description:
    "Jeton de concurrence optimistic lock (updated_at), prioritaire sur le body.",
  schemaName: "IfMatchHeaderParameter",
  schema: ifMatchHeaderSchema,
  required: false,
});

const ifMatchHeaderRequiredParameter = headerParameter({
  name: "if-match",
  description: "Jeton de concurrence obligatoire (updated_at).",
  schemaName: "IfMatchRequiredHeaderParameter",
  schema: ifMatchHeaderSchema,
  required: true,
});

const templatesSearchQueryParameter = queryParameter({
  name: "search",
  description: "Recherche textuelle sur le nom du template.",
  schemaName: "TemplatesSearchQueryParameter",
  schema: listEstimateTemplatesQuerySchema.shape.search,
  required: false,
});

const templatesLimitQueryParameter = queryParameter({
  name: "limit",
  description: "Nombre maximal de resultats (<= 100).",
  schemaName: "TemplatesLimitQueryParameter",
  schema: listEstimateTemplatesQuerySchema.shape.limit,
  required: false,
});

const templatesOrderQueryParameter = queryParameter({
  name: "order",
  description: "Ordre de tri des templates.",
  schemaName: "TemplatesOrderQueryParameter",
  schema: listEstimateTemplatesQuerySchema.shape.order,
  required: false,
});

const assembliesSearchQueryParameter = queryParameter({
  name: "search",
  description: "Recherche textuelle sur le nom de l'assemblage.",
  schemaName: "AssembliesSearchQueryParameter",
  schema: listEstimateAssembliesQuerySchema.shape.search,
  required: false,
});

const assembliesLimitQueryParameter = queryParameter({
  name: "limit",
  description: "Nombre maximal de resultats (<= 100).",
  schemaName: "AssembliesLimitQueryParameter",
  schema: listEstimateAssembliesQuerySchema.shape.limit,
  required: false,
});

const assembliesOrderQueryParameter = queryParameter({
  name: "order",
  description: "Ordre de tri des assemblages.",
  schemaName: "AssembliesOrderQueryParameter",
  schema: listEstimateAssembliesQuerySchema.shape.order,
  required: false,
});

const suggestPricesQueryParameter = queryParameter({
  name: "q",
  description: "Texte de recherche pour la suggestion de prix catalogue.",
  schemaName: "SuggestPricesQueryParameter",
  schema: suggestPricesQuerySchema,
  required: true,
});

const changelogCompareQueryParameter = queryParameter({
  name: "compare",
  description: "UUID de la version a comparer.",
  schemaName: "ChangelogCompareQueryParameter",
  schema: uuidSchema,
  required: true,
});

const changelogFormatQueryParameter = queryParameter({
  name: "format",
  description: "Format de rendu du changelog (json ou pdf).",
  schemaName: "ChangelogFormatQueryParameter",
  schema: changelogFormatQuerySchema,
  required: false,
});

const lockForceQueryParameter = queryParameter({
  name: "force",
  description: "Forcer l'operation de verrouillage/deverrouillage.",
  schemaName: "LockForceQueryParameter",
  schema: forceQuerySchema,
  required: false,
});

const batchDryRunQueryParameter = queryParameter({
  name: "dry_run",
  description: "Quand true, valide les operations sans ecriture.",
  schemaName: "BatchDryRunQueryParameter",
  schema: dryRunQuerySchema,
  required: false,
});

const pdfForceQueryParameter = queryParameter({
  name: "force",
  description: "Forcer une regeneration du PDF.",
  schemaName: "PdfForceQueryParameter",
  schema: forceQuerySchema,
  required: false,
});

const pdfFormatQueryParameter = queryParameter({
  name: "format",
  description: "Quand `json`, retourne le statut JSON au lieu d'une redirection.",
  schemaName: "PdfFormatQueryParameter",
  schema: pdfFormatQuerySchema,
  required: false,
});

const exportFormatQueryParameter = queryParameter({
  name: "format",
  description: "Format d'export (xlsx uniquement en v1).",
  schemaName: "ExportFormatQueryParameter",
  schema: exportFormatQuerySchema,
  required: false,
});

const insertAssemblyVersionIdQueryParameter = queryParameter({
  name: "versionId",
  description: "UUID de la version recevant l'insertion de l'assemblage.",
  schemaName: "InsertAssemblyVersionIdQueryParameter",
  schema: uuidSchema,
  required: true,
});

const pdfRedirectLocationHeader = responseHeader({
  name: "Location",
  description: "URL signee de telechargement du PDF genere.",
  schemaName: "PdfRedirectLocationHeader",
  schema: z.string().url(),
  required: true,
});

const exportContentDispositionHeader = responseHeader({
  name: "Content-Disposition",
  description: "Nom du fichier exporte.",
  schemaName: "ExportContentDispositionHeader",
  schema: z.string().min(1),
  required: true,
});

const exportProgressHeader = responseHeader({
  name: "X-Export-Progress",
  description: "Progression de l'export (0-100).",
  schemaName: "ExportProgressHeader",
  schema: z.string().regex(/^[0-9]{1,3}$/),
  required: false,
});

const createEstimateBody = jsonBody({
  name: "CreateEstimateRequest",
  description: "Payload de creation d'un chiffrage.",
  schema: createEstimateSchema,
});

const patchEstimateVersionBody = jsonBody({
  name: "PatchEstimateVersionRequest",
  description: "Champs de mise a jour de la version de chiffrage.",
  schema: patchEstimateVersionSchema,
});

const patchEstimateStatusBody = jsonBody({
  name: "PatchEstimateStatusRequest",
  description: "Nouveau statut cible pour la version.",
  schema: patchEstimateStatusSchema,
});

const createVariantBody = jsonBody({
  name: "CreateEstimateVariantRequest",
  description: "Payload optionnel de creation de variante.",
  schema: createEstimateVariantSchema,
  required: false,
});

const promoteVariantBody = jsonBody({
  name: "PromoteEstimateVariantRequest",
  description: "Payload optionnel de promotion d'une variante.",
  schema: promoteEstimateVariantSchema,
  required: false,
});

const createEstimateItemBody = jsonBody({
  name: "CreateEstimateItemRequest",
  description: "Creation d'un item (section ou ligne).",
  schema: createEstimateItemSchema,
});

const updateEstimateItemBody = jsonBody({
  name: "UpdateEstimateItemRequest",
  description: "Mise a jour partielle d'un item.",
  schema: updateEstimateItemSchema,
});

const deleteEstimateItemBody = jsonBody({
  name: "DeleteEstimateItemRequest",
  description: "Suppression d'un item via son UUID.",
  schema: deleteEstimateItemSchema,
});

const reorderEstimateItemsBody = jsonBody({
  name: "ReorderEstimateItemsRequest",
  description: "Nouvel ordre des items sous un parent.",
  schema: reorderEstimateItemsSchema,
});

const bulkUpdateEstimateItemsBody = jsonBody({
  name: "BulkUpdateEstimateItemsRequest",
  description: "Mise a jour en lot des items.",
  schema: bulkUpdateEstimateItemsRequestSchema,
});

const batchOperationsBody = jsonBody({
  name: "BatchEstimateOperationsRequest",
  description:
    "Execution groupee d'operations create/update/delete/reorder avec token de concurrence.",
  schema: batchOperationsSchema,
});

const supplierComparisonsBody = jsonBody({
  name: "EstimateSupplierComparisonsRequest",
  description: "Liste des lignes a comparer par fournisseur.",
  schema: estimateSupplierComparisonsRequestSchema,
});

const createCategoryBody = jsonBody({
  name: "CreateEstimateCategoryRequest",
  description: "Creation d'une categorie de ligne.",
  schema: createEstimateCategorySchema,
});

const createLaborRoleBody = jsonBody({
  name: "CreateLaborRoleRequest",
  description: "Creation d'un role de main d'oeuvre.",
  schema: createLaborRoleSchema,
});

const updateLaborRoleBody = jsonBody({
  name: "UpdateLaborRoleRequest",
  description: "Mise a jour d'un role de main d'oeuvre.",
  schema: updateLaborRoleSchema,
});

const createSuggestionRuleBody = jsonBody({
  name: "CreateSuggestionRuleRequest",
  description: "Creation d'une regle de suggestion.",
  schema: createSuggestionRuleSchema,
});

const updateSuggestionRuleBody = jsonBody({
  name: "UpdateSuggestionRuleRequest",
  description: "Mise a jour d'une regle de suggestion.",
  schema: updateSuggestionRuleSchema,
});

const suggestionRuleFeedbackBody = jsonBody({
  name: "SuggestionRuleFeedbackRequest",
  description: "Feedback utilisateur sur une suggestion appliquee.",
  schema: suggestionRuleFeedbackSchema,
});

const outlierToggleBody = jsonBody({
  name: "ToggleOutlierDismissRequest",
  description: "Activation/desactivation du dismissal d'un outlier.",
  schema: toggleOutlierDismissSchema,
});

const createTemplateFromVersionBody = jsonBody({
  name: "CreateEstimateTemplateFromVersionRequest",
  description: "Creation d'un template a partir d'une version existante.",
  schema: createEstimateTemplateFromVersionSchema,
});

const updateTemplateBody = jsonBody({
  name: "UpdateEstimateTemplateRequest",
  description: "Mise a jour d'un template existant.",
  schema: updateEstimateTemplateSchema,
});

const instantiateTemplateBody = jsonBody({
  name: "InstantiateEstimateFromTemplateRequest",
  description: "Creation d'un chiffrage depuis un template.",
  schema: instantiateEstimateFromTemplateSchema,
});

const duplicateTemplateBody = jsonBody({
  name: "DuplicateEstimateTemplateRequest",
  description: "Payload optionnel de duplication de template.",
  schema: duplicateEstimateTemplateSchema,
  required: false,
});

const createAssemblyBody = jsonBody({
  name: "CreateEstimateAssemblyRequest",
  description: "Creation d'un assemblage de lignes.",
  schema: createEstimateAssemblySchema,
});

const updateAssemblyBody = jsonBody({
  name: "UpdateEstimateAssemblyRequest",
  description: "Mise a jour d'un assemblage.",
  schema: updateEstimateAssemblySchema,
});

const insertAssemblyBody = jsonBody({
  name: "InsertAssemblyIntoVersionBodyRequest",
  description: "Position optionnelle d'insertion de l'assemblage.",
  schema: insertAssemblyIntoVersionBodySchema,
  required: false,
});

const apiSuccessUnknownSchemaDefinition = openApiSharedSchemaDefinitions.apiSuccessUnknown;
const apiOutlierStateSchemaDefinition =
  openApiSharedSchemaDefinitions.apiOutlierStateResponse;
const apiPdfStatusSchemaDefinition = openApiSharedSchemaDefinitions.apiPdfStatusResponse;

export const openApiOperationsRegistry: OpenApiOperationDefinition[] = [
  {
    method: "get",
    path: "/api/estimates",
    summary: "Lister les chiffrages",
    description: "Retourne les derniers chiffrages accessibles a l'utilisateur.",
    tags: ["Estimates"],
    responses: {
      "200": jsonResponse(
        "Liste des chiffrages retournee.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates",
    summary: "Creer un chiffrage",
    description: "Cree un projet + une version initiale de chiffrage.",
    tags: ["Estimates"],
    requestBody: createEstimateBody,
    responses: {
      "201": jsonResponse(
        "Chiffrage cree avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}",
    summary: "Recuperer une version",
    description: "Retourne le detail complet d'une version de chiffrage.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Version de chiffrage retournee.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}",
    summary: "Modifier une version",
    description:
      "Met a jour les metadonnees et/ou les totaux de la version de chiffrage.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter, ifMatchHeaderOptionalParameter],
    requestBody: patchEstimateVersionBody,
    responses: {
      "200": jsonResponse(
        "Version de chiffrage mise a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/status",
    summary: "Changer le statut d'une version",
    description: "Met a jour le statut metier de la version (draft/sent/...).",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter, ifMatchHeaderRequiredParameter],
    requestBody: patchEstimateStatusBody,
    responses: {
      "200": jsonResponse(
        "Statut de version mis a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/duplicate",
    summary: "Dupliquer une version",
    description: "Cree une nouvelle version a partir d'une version existante.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    responses: {
      "201": jsonResponse(
        "Version dupliquee avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/verify",
    summary: "Verifier l'integrite",
    description: "Verifie le sceau d'integrite de la version.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Resultat de verification retourne.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/variants",
    summary: "Creer une variante",
    description: "Cree une variante de la version en cours.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    requestBody: createVariantBody,
    responses: {
      "201": jsonResponse(
        "Variante creee avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/variants",
    summary: "Promouvoir une variante",
    description: "Promeut une variante comme version active.",
    tags: ["Estimate Versions"],
    parameters: [versionIdPathParameter],
    requestBody: promoteVariantBody,
    responses: {
      "200": jsonResponse(
        "Variante promue avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/items",
    summary: "Lister les items",
    description: "Retourne la structure des sections/lignes de la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse("Items retournes.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items",
    summary: "Ajouter un item",
    description: "Ajoute une section ou une ligne dans la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: createEstimateItemBody,
    responses: {
      "201": jsonResponse(
        "Item cree avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/items",
    summary: "Modifier un item",
    description: "Met a jour une ligne ou section existante.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: updateEstimateItemBody,
    responses: {
      "200": jsonResponse("Item mis a jour.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/{versionId}/items",
    summary: "Supprimer un item",
    description: "Supprime une ligne ou section de la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: deleteEstimateItemBody,
    responses: {
      "200": jsonResponse("Item supprime.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items/reorder",
    summary: "Reordonner les items",
    description: "Reordonne les items d'un meme parent dans la version.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: reorderEstimateItemsBody,
    responses: {
      "200": jsonResponse(
        "Ordre des items mis a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/items/bulk",
    summary: "Mise a jour bulk d'items",
    description: "Applique un lot de modifications sur plusieurs lignes.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter, ifMatchHeaderOptionalParameter],
    requestBody: bulkUpdateEstimateItemsBody,
    responses: {
      "200": jsonResponse(
        "Mise a jour bulk appliquee.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/batch",
    summary: "Executer un batch d'operations",
    description:
      "Execute en un appel un lot d'operations create/update/delete/reorder.",
    tags: ["Estimate Items"],
    parameters: [
      versionIdPathParameter,
      ifMatchHeaderOptionalParameter,
      batchDryRunQueryParameter,
    ],
    requestBody: batchOperationsBody,
    responses: {
      "200": jsonResponse(
        "Batch execute avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/export",
    summary: "Exporter un devis en streaming",
    description:
      "Genere un fichier XLSX en streaming pour telechargement direct.",
    tags: ["Estimate Output"],
    parameters: [versionIdPathParameter, exportFormatQueryParameter],
    responses: {
      "200": {
        description: "Flux binaire XLSX retourne.",
        headers: [exportContentDispositionHeader, exportProgressHeader],
        contents: [
          {
            contentType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        ],
      },
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/supplier-comparisons",
    summary: "Comparer les fournisseurs",
    description: "Retourne des comparatifs de prix fournisseurs par item.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: supplierComparisonsBody,
    responses: {
      "200": jsonResponse(
        "Comparatifs fournisseurs retournes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/suggest-prices",
    summary: "Suggérer des prix",
    description: "Interroge le catalogue pour suggerer des prix par recherche.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter, suggestPricesQueryParameter],
    responses: {
      "200": jsonResponse(
        "Suggestions de prix retournees.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/categories",
    summary: "Creer une categorie",
    description: "Ajoute une categorie de classement des lignes.",
    tags: ["Estimate Items"],
    parameters: [versionIdPathParameter],
    requestBody: createCategoryBody,
    responses: {
      "201": jsonResponse(
        "Categorie creee avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/labor-roles",
    summary: "Creer un role de MO",
    description: "Ajoute un role de main d'oeuvre sur la version.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter],
    requestBody: createLaborRoleBody,
    responses: {
      "201": jsonResponse(
        "Role de main d'oeuvre cree.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/labor-roles/{roleId}",
    summary: "Modifier un role de MO",
    description: "Met a jour un role de main d'oeuvre existant.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter, roleIdPathParameter],
    requestBody: updateLaborRoleBody,
    responses: {
      "200": jsonResponse(
        "Role de main d'oeuvre mis a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/suggestion-rules",
    summary: "Creer une regle de suggestion",
    description: "Ajoute une regle de suggestion pour les lignes du devis.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter],
    requestBody: createSuggestionRuleBody,
    responses: {
      "201": jsonResponse(
        "Regle de suggestion creee.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/suggestion-rules/{ruleId}",
    summary: "Modifier une regle de suggestion",
    description: "Met a jour une regle de suggestion existante.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter, ruleIdPathParameter],
    requestBody: updateSuggestionRuleBody,
    responses: {
      "200": jsonResponse(
        "Regle de suggestion mise a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/suggestion-rules/{ruleId}/feedback",
    summary: "Enregistrer un feedback",
    description: "Enregistre un feedback d'acceptation/rejet sur une suggestion.",
    tags: ["Estimate Rules"],
    parameters: [versionIdPathParameter, ruleIdPathParameter],
    requestBody: suggestionRuleFeedbackBody,
    responses: {
      "200": jsonResponse(
        "Feedback de suggestion enregistre.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/events",
    summary: "Lister les evenements",
    description: "Retourne l'historique des evenements de version.",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Evenements de version retournes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/gating",
    summary: "Verifier le gating d'envoi",
    description:
      "Retourne l'etat des prerequis pour l'envoi (verrous, donnees requises, etc.).",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Etat de gating retourne.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/outliers",
    summary: "Lister les outliers dismiss",
    description:
      "Retourne les outliers marques comme dismiss par item de la version.",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Etat des outliers retourne.",
        apiOutlierStateSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/outliers",
    summary: "Basculer un outlier dismiss",
    description: "Accepte ou reactive un outlier detecte sur un item.",
    tags: ["Estimate Diagnostics"],
    parameters: [versionIdPathParameter],
    requestBody: outlierToggleBody,
    responses: {
      "200": jsonResponse(
        "Etat des outliers mis a jour.",
        apiOutlierStateSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/changelog",
    summary: "Comparer deux versions",
    description:
      "Retourne le changelog JSON ou un rendu PDF entre deux versions d'un meme projet.",
    tags: ["Estimate Diagnostics"],
    parameters: [
      versionIdPathParameter,
      changelogCompareQueryParameter,
      changelogFormatQueryParameter,
    ],
    responses: {
      "200": {
        description: "Changelog calcule avec succes (JSON ou PDF).",
        contents: [
          {
            contentType: "application/json",
            schema: apiSuccessUnknownSchemaDefinition,
          },
          {
            contentType: "application/pdf",
          },
        ],
      },
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/lock",
    summary: "Acquerir un verrou",
    description: "Acquiert le verrou d'edition d'une version brouillon.",
    tags: ["Estimate Locks"],
    parameters: [versionIdPathParameter],
    responses: {
      "201": jsonResponse("Verrou acquis.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/{versionId}/lock",
    summary: "Renouveler un verrou",
    description: "Renouvelle le verrou d'edition sur la version brouillon.",
    tags: ["Estimate Locks"],
    parameters: [versionIdPathParameter, lockForceQueryParameter],
    responses: {
      "200": jsonResponse("Verrou renouvele.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/{versionId}/lock",
    summary: "Relacher un verrou",
    description: "Relache le verrou d'edition sur la version brouillon.",
    tags: ["Estimate Locks"],
    parameters: [versionIdPathParameter, lockForceQueryParameter],
    responses: {
      "200": jsonResponse("Verrou relache.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/{versionId}/pdf",
    summary: "Declencher la generation PDF",
    description:
      "Declenche une generation PDF immediate. Retourne `ready` ou `processing`.",
    tags: ["Estimate PDF"],
    parameters: [versionIdPathParameter, pdfForceQueryParameter],
    responses: {
      "200": jsonResponse(
        "Statut PDF retourne (deja pret).",
        apiPdfStatusSchemaDefinition
      ),
      "202": jsonResponse(
        "Generation PDF en cours.",
        apiPdfStatusSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/{versionId}/pdf",
    summary: "Recuperer un PDF ou son statut",
    description:
      "Retourne le statut JSON (`format=json`) ou redirige vers le PDF signe.",
    tags: ["Estimate PDF"],
    parameters: [versionIdPathParameter, pdfFormatQueryParameter],
    responses: {
      "200": jsonResponse(
        "Statut PDF JSON retourne.",
        apiPdfStatusSchemaDefinition
      ),
      "202": jsonResponse(
        "Generation PDF encore en cours.",
        apiPdfStatusSchemaDefinition
      ),
      "307": {
        description: "Redirection vers le fichier PDF signe.",
        headers: [pdfRedirectLocationHeader],
      },
    },
  },
  {
    method: "get",
    path: "/api/estimates/templates",
    summary: "Lister les templates",
    description: "Retourne la liste des templates de chiffrage.",
    tags: ["Estimate Templates"],
    parameters: [
      templatesSearchQueryParameter,
      templatesLimitQueryParameter,
      templatesOrderQueryParameter,
    ],
    responses: {
      "200": jsonResponse("Templates retournes.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "post",
    path: "/api/estimates/templates",
    summary: "Creer un template depuis une version",
    description: "Cree un template de chiffrage a partir d'une version source.",
    tags: ["Estimate Templates"],
    requestBody: createTemplateFromVersionBody,
    responses: {
      "201": jsonResponse(
        "Template cree avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/templates/{templateId}",
    summary: "Recuperer un template",
    description: "Retourne le detail d'un template.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    responses: {
      "200": jsonResponse("Template retourne.", apiSuccessUnknownSchemaDefinition),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/templates/{templateId}",
    summary: "Modifier un template",
    description: "Met a jour le nom et/ou la description d'un template.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    requestBody: updateTemplateBody,
    responses: {
      "200": jsonResponse(
        "Template mis a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/templates/{templateId}",
    summary: "Supprimer un template",
    description: "Supprime un template existant.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Template supprime.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/templates/{templateId}/instantiate",
    summary: "Instancier un template",
    description: "Cree un nouveau chiffrage depuis un template existant.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    requestBody: instantiateTemplateBody,
    responses: {
      "201": jsonResponse(
        "Chiffrage instancie depuis le template.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/templates/{templateId}/duplicate",
    summary: "Dupliquer un template",
    description: "Duplique un template en optionnellement renommant la copie.",
    tags: ["Estimate Templates"],
    parameters: [templateIdPathParameter],
    requestBody: duplicateTemplateBody,
    responses: {
      "201": jsonResponse(
        "Template duplique avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/assemblies",
    summary: "Lister les assemblages",
    description: "Retourne la liste des assemblages reutilisables.",
    tags: ["Estimate Assemblies"],
    parameters: [
      assembliesSearchQueryParameter,
      assembliesLimitQueryParameter,
      assembliesOrderQueryParameter,
    ],
    responses: {
      "200": jsonResponse(
        "Assemblages retournes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/assemblies",
    summary: "Creer un assemblage",
    description: "Cree un nouvel assemblage de lignes.",
    tags: ["Estimate Assemblies"],
    requestBody: createAssemblyBody,
    responses: {
      "201": jsonResponse(
        "Assemblage cree avec succes.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "get",
    path: "/api/estimates/assemblies/{assemblyId}",
    summary: "Recuperer un assemblage",
    description: "Retourne le detail complet d'un assemblage.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Assemblage retourne.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "patch",
    path: "/api/estimates/assemblies/{assemblyId}",
    summary: "Modifier un assemblage",
    description: "Met a jour le nom, la description et/ou les lignes d'un assemblage.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter],
    requestBody: updateAssemblyBody,
    responses: {
      "200": jsonResponse(
        "Assemblage mis a jour.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "delete",
    path: "/api/estimates/assemblies/{assemblyId}",
    summary: "Supprimer un assemblage",
    description: "Supprime un assemblage existant.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter],
    responses: {
      "200": jsonResponse(
        "Assemblage supprime.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
  {
    method: "post",
    path: "/api/estimates/assemblies/{assemblyId}/insert",
    summary: "Inserer un assemblage dans une version",
    description:
      "Insere un assemblage dans une version cible, optionnellement apres un item.",
    tags: ["Estimate Assemblies"],
    parameters: [assemblyIdPathParameter, insertAssemblyVersionIdQueryParameter],
    requestBody: insertAssemblyBody,
    responses: {
      "200": jsonResponse(
        "Assemblage insere dans la version.",
        apiSuccessUnknownSchemaDefinition
      ),
    },
  },
];
