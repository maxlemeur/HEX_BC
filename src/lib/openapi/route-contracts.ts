import { z, type ZodTypeAny } from "zod";

import {
  productActionSchema,
  supplierActionSchema,
} from "@/lib/catalogue/directory-schemas";
import {
  catalogueActionSchema,
  indicesActionSchema,
} from "@/lib/catalogue/schemas";
import {
  createMarginTierSchema,
  updateMarginTierSchema,
} from "@/lib/estimates/schemas";
import { mappingsActionSchema } from "@/lib/mappings/schemas";
import {
  createMembershipSchema,
  tenantRoleSchema,
  updateMembershipSchema,
} from "@/lib/memberships/schemas";
import type {
  OpenApiContentType,
  OpenApiHttpMethod,
  OpenApiOperationDefinition,
  OpenApiParameterDefinition,
  OpenApiRequestBodyDefinition,
  OpenApiResponseDefinition,
  OpenApiSchemaDefinition,
} from "@/lib/openapi/registry";

export const routeContractUuidSchema = z.string().uuid();
const uuidSchema = routeContractUuidSchema;
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const jsonRecordSchema = z.record(z.string(), z.unknown());

export const genericOkResponseDefinition: OpenApiSchemaDefinition = {
  schemaName: "ApiGenericSuccessResponse",
  schema: z.object({ ok: z.literal(true), data: z.unknown() }),
  io: "output",
};
const genericJsonResponseDefinition: OpenApiSchemaDefinition = {
  schemaName: "ApiGenericJsonResponse",
  schema: z.unknown(),
  io: "output",
};
const genericErrorResponseDefinition: OpenApiSchemaDefinition = {
  schemaName: "ApiGenericErrorResponse",
  schema: z.unknown(),
  io: "output",
};
export const csvResponseDefinition: OpenApiSchemaDefinition = {
  schemaName: "CsvTextResponse",
  schema: z.string(),
  io: "output",
};

type ParameterContract = {
  name: string;
  schema: ZodTypeAny;
  description: string;
  required?: boolean;
};

type BodyContract = {
  schema: ZodTypeAny;
  description: string;
  contentType?: "application/json" | "multipart/form-data";
  required?: boolean;
  alternates?: Array<{
    schema: ZodTypeAny;
    contentType: "application/json" | "multipart/form-data";
  }>;
};

export type MultiContentRequestBodyDefinition = OpenApiRequestBodyDefinition & {
  additionalContents?: Array<{
    contentType: "application/json" | "multipart/form-data";
    schema: OpenApiSchemaDefinition;
  }>;
};

type SuccessContract = {
  status: string;
  description: string;
  contentType?: OpenApiContentType;
  rawJson?: boolean;
  schema?: OpenApiSchemaDefinition;
  contents?: Array<{
    contentType: OpenApiContentType;
    schema?: OpenApiSchemaDefinition;
  }>;
};

export type RouteContract = {
  id: string;
  method: OpenApiHttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  pathParameters?: ParameterContract[];
  queryParameters?: ParameterContract[];
  body?: BodyContract;
  success?: SuccessContract[];
  rawErrors?: boolean;
  extraErrors?: Array<{ status: string; description: string }>;
};

function contractName(id: string, suffix: string): string {
  return `${id.replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("")}${suffix}`;
}

function toParameter(
  id: string,
  location: "path" | "query",
  input: ParameterContract
): OpenApiParameterDefinition {
  return {
    in: location,
    name: input.name,
    description: input.description,
    required: location === "path" ? true : input.required ?? false,
    schemaName: contractName(
      id,
      `${contractName(input.name, "")}Parameter`
    ),
    schema: input.schema,
    io: "input",
  };
}

function toRequestBody(
  id: string,
  input: BodyContract
): MultiContentRequestBodyDefinition {
  return {
    schemaName: contractName(id, "Request"),
    schema: input.schema,
    io: "input",
    contentType: input.contentType ?? "application/json",
    required: input.required ?? true,
    description: input.description,
    additionalContents: input.alternates?.map((alternate, index) => ({
      contentType: alternate.contentType,
      schema: {
        schemaName: contractName(id, `AlternateRequest${index + 1}`),
        schema: alternate.schema,
        io: "input",
      },
    })),
  };
}

function jsonResponse(
  description: string,
  schema: OpenApiSchemaDefinition
): OpenApiResponseDefinition {
  return {
    description,
    contents: [{ contentType: "application/json", schema }],
  };
}

export function buildOpenApiRouteOperation(
  input: RouteContract
): OpenApiOperationDefinition {
  const responses: Record<string, OpenApiResponseDefinition> = {};
  (input.success ?? [
    { status: "200", description: "Operation executee avec succes." },
  ]).forEach((success) => {
    const contentType = success.contentType ?? "application/json";
    responses[success.status] = {
      description: success.description,
      contents:
        success.contents ??
        [
          {
            contentType,
            schema:
              success.schema ??
              (contentType === "application/json"
                ? success.rawJson
                  ? genericJsonResponseDefinition
                  : genericOkResponseDefinition
                : undefined),
          },
        ],
    };
  });
  if (input.rawErrors) {
    ["400", "401", "403", "404", "409", "500"].forEach((status) => {
      responses[status] = jsonResponse(
        "Erreur retournee par la route.",
        genericErrorResponseDefinition
      );
    });
  }
  input.extraErrors?.forEach((error) => {
    responses[error.status] = jsonResponse(
      error.description,
      genericErrorResponseDefinition
    );
  });

  return {
    method: input.method,
    path: input.path,
    summary: input.summary,
    description: input.description,
    tags: input.tags,
    parameters: [
      ...(input.pathParameters ?? []).map((parameter) =>
        toParameter(input.id, "path", parameter)
      ),
      ...(input.queryParameters ?? []).map((parameter) =>
        toParameter(input.id, "query", parameter)
      ),
    ],
    requestBody: input.body ? toRequestBody(input.id, input.body) : undefined,
    responses,
  };
}

const projectIdParameter: ParameterContract = {
  name: "projectId",
  schema: uuidSchema,
  description: "Identifiant UUID de l'affaire.",
};
export const versionIdParameter: ParameterContract = {
  name: "versionId",
  schema: uuidSchema,
  description: "Identifiant UUID de la version de devis.",
};
export const jobIdParameter: ParameterContract = {
  name: "jobId",
  schema: uuidSchema,
  description: "Identifiant UUID du job Takeoff.",
};

const bulkAffairesSchema = z.object({
  projectIds: z.array(uuidSchema).min(1).max(1000),
});
const affaireIntakeFormSchema = z
  .object({
    files: z.array(z.any()).min(1).max(50).optional(),
    file: z.any().optional(),
  })
  .refine((input) => Boolean(input.file || input.files?.length));

const productTemplateRowSchema = z.object({
  reference: z.string().trim().min(1).max(255),
  designation: z.string().trim().min(1).max(500),
  category: z.string().trim().max(255).nullable(),
  product_type: z.string().trim().max(255).nullable(),
  material: z.string().trim().max(255).nullable(),
  grade: z.string().trim().max(255).nullable(),
  dimensions: z.string().trim().max(255).nullable(),
  standard: z.string().trim().max(255).nullable(),
  unit: z.string().trim().min(1).max(50),
  unit_price_cents: z.number().int().min(0),
  is_active: z.literal(true),
});
const supplierPriceTemplateRowSchema = z.object({
  product_reference: z.string().trim().min(1).max(255),
  supplier_name: z.string().trim().min(1).max(255),
  supplier_sku: z.string().trim().max(255).nullable(),
  unit_price_cents: z.number().int().positive(),
  unit: z.string().trim().min(1).max(50),
  currency: z.string().trim().length(3),
  valid_from: dateOnlySchema,
  min_quantity: z.number().positive().max(999999999),
  source_url: z.string().trim().url().max(2000).nullable(),
  comment: z.string().trim().max(2000).nullable(),
});
const productPriceTemplateImportSchema = z.object({
  products: z.array(productTemplateRowSchema).max(5000),
  prices: z.array(supplierPriceTemplateRowSchema).max(5000),
});

const currencyRateCreateSchema = z.object({
  tenant_id: uuidSchema.optional(),
  from_currency: z.string().trim().min(1),
  to_currency: z.string().trim().min(1),
  rate: z.number().finite(),
  effective_date: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  is_active: z.boolean().optional(),
});
const currencyRatePatchSchema = z.object({
  tenant_id: uuidSchema.optional(),
  rate: z.number().finite().optional(),
  effective_date: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  is_active: z.boolean().optional(),
});
const featureFlagPatchSchema = z.object({
  tenant_id: uuidSchema.optional(),
  flag_key: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
  value: z.string().nullable().optional(),
});

const tabularPdfRowSchema = z.object({
  rowIndex: z.number().int().min(0),
  cells: z.record(z.string(), z.unknown()),
});
const tabularPdfTableSchema = z.object({
  page: z.number().int().positive(),
  tableIndex: z.number().int().min(0),
  title: z.string().nullable().optional(),
  headers: z.array(z.string()),
  rows: z.array(tabularPdfRowSchema),
});
const tabularPdfReviewSchema = z.object({
  sourceFileName: z.string().optional(),
  sourceDocumentId: z.string().nullable().optional(),
  tables: z.array(tabularPdfTableSchema).min(1),
});
const importJsonSchema = z
  .object({
    rows: z.array(jsonRecordSchema).optional(),
    tables: z.array(tabularPdfTableSchema).optional(),
    filename: z.string().optional(),
    sourceFormat: z.enum(["json", "csv", "xlsx"]).optional(),
    sourceKind: z.enum(["tabular", "tabular_pdf"]).optional(),
    projectId: uuidSchema.nullable().optional(),
    storagePath: z.string().nullable().optional(),
    fileSizeBytes: z.number().int().min(0).nullable().optional(),
    validation: jsonRecordSchema.optional(),
  })
  .passthrough()
  .refine((input) => Boolean(input.rows || input.tables));
const importMultipartSchema = z.object({
  file: z.any(),
  headerRowNumber: z.number().int().positive().optional(),
  projectId: uuidSchema.optional(),
  filename: z.string().optional(),
  sourceDocumentId: z.string().optional(),
});
const tabularPdfReviewFileSchema = z.object({
  file: z.any(),
  sourceDocumentId: z.string().optional(),
});

const tenantMembershipActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set-role"),
    membership_id: uuidSchema,
    role: tenantRoleSchema,
  }),
  z.object({
    action: z.literal("set-default"),
    membership_id: uuidSchema,
  }),
]);

export const portalAcceptSchema = z.object({
  accepted_terms: z.literal(true),
  signature_base64: z
    .string()
    .startsWith("data:image/png;base64,")
    .max(700000)
    .optional(),
});
export const portalRejectSchema = z.object({ reason: z.string().max(1000).optional() });

const purchaseOrderLineSchema = z.object({
  productId: uuidSchema.nullable().optional(),
  reference: z.string().nullable().optional(),
  designation: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().finite().min(0),
  taxRateBp: z.number().finite().min(0).max(10000),
});
export const purchaseOrderCreateSchema = z.object({
  supplierId: uuidSchema,
  deliverySiteId: uuidSchema,
  expectedDeliveryDate: z.union([dateOnlySchema, z.literal("TBD"), z.null()]).optional(),
  notes: z.string().nullable().optional(),
  items: z.array(purchaseOrderLineSchema).min(1),
});
export const purchaseOrderUpdateSchema = z.object({
  supplierId: uuidSchema.optional(),
  deliverySiteId: uuidSchema.optional(),
  expectedDeliveryDate: z.union([dateOnlySchema, z.literal("TBD"), z.null()]).optional(),
  notes: z.string().nullable().optional(),
  items: z.array(purchaseOrderLineSchema).min(1).optional(),
});
export const purchaseOrderDevisFormSchema = z.object({
  file: z.any(),
  name: z.string().optional(),
});
export const purchaseOrderDevisPatchSchema = z.object({ name: z.string().trim().min(1) });
export const purchaseOrderDevisReorderSchema = z.object({
  orderedIds: z.array(uuidSchema).min(1),
});

const takeoffItemPatchFieldsSchema = z.object({
  designation: z.string().trim().min(1).max(500).optional(),
  quantity: z.number().finite().positive().optional(),
  unit: z.string().trim().min(1).max(64).optional(),
  is_excluded: z.boolean().optional(),
  exclusion_reason: z.string().trim().min(1).max(500).nullable().optional(),
  is_verified: z.boolean().optional(),
  evidence: z.string().trim().min(1).max(2000).nullable().optional(),
});
export const takeoffItemsPatchSchema = z.object({
  items: z
    .array(
      z.object({
        item_id: uuidSchema,
        updated_at: z.string().min(1),
        fields: takeoffItemPatchFieldsSchema,
      })
    )
    .min(1)
    .max(100),
});
export const takeoffPlanSetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  metadata: jsonRecordSchema.optional(),
});
export const insertTemplateIntoVersionBodySchema = z.object({
  version_id: uuidSchema.optional(),
  after_item_id: uuidSchema.nullable().optional(),
});

const administrationContracts: RouteContract[] = [
  {
    id: "get-affaire-dpgf-source",
    method: "get",
    path: "/api/affaires/{projectId}/dpgf-source",
    summary: "Lire la source DPGF liee a une affaire",
    description: "Retourne la source DPGF rattachee a l'affaire accessible.",
    tags: ["Affaires"],
    pathParameters: [projectIdParameter],
  },
  {
    id: "create-affaire-intake-files",
    method: "post",
    path: "/api/affaires/{projectId}/intake/files",
    summary: "Deposer les fichiers d'intake d'une affaire",
    description:
      "Accepte un lot multipart, persiste les fichiers et programme leur traitement asynchrone.",
    tags: ["Affaires"],
    pathParameters: [projectIdParameter],
    body: {
      schema: affaireIntakeFormSchema,
      description: "Fichier unique `file` ou lot `files` (maximum 50 fichiers et 100 Mo cumules).",
      contentType: "multipart/form-data",
    },
    success: [{ status: "201", description: "Upload intake cree." }],
  },
  {
    id: "delete-affaire",
    method: "delete",
    path: "/api/affaires/{projectId}",
    summary: "Supprimer une affaire brouillon",
    description: "Supprime atomiquement une affaire eligible en brouillon.",
    tags: ["Affaires"],
    pathParameters: [projectIdParameter],
  },
  {
    id: "bulk-archive-affaires",
    method: "post",
    path: "/api/affaires/bulk-archive",
    summary: "Archiver des affaires brouillon",
    description: "Archive jusqu'a 1 000 affaires et retourne les echecs par affaire.",
    tags: ["Affaires"],
    body: { schema: bulkAffairesSchema, description: "Identifiants des affaires a archiver." },
  },
  {
    id: "bulk-delete-affaires",
    method: "post",
    path: "/api/affaires/bulk-delete",
    summary: "Supprimer des affaires brouillon",
    description: "Supprime jusqu'a 1 000 affaires et retourne les echecs par affaire.",
    tags: ["Affaires"],
    body: { schema: bulkAffairesSchema, description: "Identifiants des affaires a supprimer." },
  },
  {
    id: "list-audit-logs",
    method: "get",
    path: "/api/audit",
    summary: "Lister les journaux d'audit",
    description: "Retourne les journaux accessibles, du plus recent au plus ancien.",
    tags: ["Administration"],
    rawErrors: true,
    queryParameters: [
      { name: "table_name", schema: z.string(), description: "Table a filtrer." },
      {
        name: "estimate_version_id",
        schema: uuidSchema,
        description: "Version de devis a filtrer.",
      },
      {
        name: "limit",
        schema: z.number().int().positive().max(200),
        description: "Nombre maximal de journaux (50 par defaut, 200 maximum).",
      },
    ],
    success: [{ status: "200", description: "Journaux d'audit retournes.", rawJson: true }],
  },
  {
    id: "list-catalogue",
    method: "get",
    path: "/api/catalogue",
    summary: "Lister le catalogue",
    description:
      "Retourne soit une liste simple, soit la vue paginee enrichie selon `view=page`.",
    tags: ["Catalogue"],
    queryParameters: [
      { name: "view", schema: z.literal("page"), description: "Active la vue paginee." },
      { name: "search", schema: z.string(), description: "Recherche de la liste simple." },
      { name: "limit", schema: z.number().int().positive().max(500), description: "Limite de la liste simple." },
      { name: "include_inactive", schema: z.boolean(), description: "Inclut les articles inactifs." },
      { name: "q", schema: z.string().max(200), description: "Recherche de la vue paginee." },
      { name: "material", schema: z.array(z.string()), description: "Filtres matiere repetables." },
      { name: "category", schema: z.array(z.string()), description: "Filtres categorie repetables." },
      { name: "unit", schema: z.array(z.string()), description: "Filtres unite repetables." },
      { name: "price_status", schema: z.array(z.enum(["fresh", "aging", "stale", "none"])), description: "Filtres fraicheur du prix." },
      { name: "status", schema: z.array(z.enum(["active", "archived"])), description: "Filtres statut." },
      { name: "sort", schema: z.enum(["designation", "material", "unit_price_cents", "best_supplier_price_cents", "updated_at"]), description: "Colonne de tri." },
      { name: "dir", schema: z.enum(["asc", "desc"]), description: "Direction du tri." },
      { name: "page", schema: z.number().int().positive(), description: "Page demandee." },
      { name: "size", schema: z.union([z.literal(25), z.literal(50), z.literal(100)]), description: "Taille de page." },
    ],
  },
  {
    id: "mutate-catalogue",
    method: "post",
    path: "/api/catalogue",
    summary: "Modifier le catalogue",
    description: "Cree, met a jour, supprime ou lie des lignes mappees au catalogue.",
    tags: ["Catalogue"],
    body: { schema: catalogueActionSchema, description: "Action catalogue discriminee." },
    success: [
      { status: "200", description: "Action catalogue executee." },
      { status: "201", description: "Article catalogue cree." },
    ],
  },
  {
    id: "import-catalogue-template",
    method: "post",
    path: "/api/catalogue/template-import",
    summary: "Importer un template produits et prix",
    description: "Cree ou actualise les produits et leurs prix depuis un template valide.",
    tags: ["Catalogue"],
    body: { schema: productPriceTemplateImportSchema, description: "Lignes produits et tarifs fournisseurs." },
    success: [{ status: "201", description: "Template importe." }],
  },
  {
    id: "list-currency-rates",
    method: "get",
    path: "/api/currency-rates",
    summary: "Lister les taux de change",
    description: "Liste les taux du tenant courant ou explicitement cible.",
    tags: ["Parametres"],
    queryParameters: [
      { name: "tenant_id", schema: uuidSchema, description: "Tenant cible." },
      { name: "from_currency", schema: z.string().min(1), description: "Devise source." },
      { name: "to_currency", schema: z.string().min(1), description: "Devise cible." },
      { name: "effective_date", schema: z.string().min(1), description: "Date d'effet." },
      { name: "include_inactive", schema: z.enum(["true", "false"]), description: "Inclut les taux inactifs." },
    ],
  },
  {
    id: "create-currency-rate",
    method: "post",
    path: "/api/currency-rates",
    summary: "Creer un taux de change",
    description: "Cree un taux de change dans le tenant autorise.",
    tags: ["Parametres"],
    body: { schema: currencyRateCreateSchema, description: "Taux et periode d'effet." },
    success: [{ status: "201", description: "Taux cree." }],
  },
  {
    id: "patch-currency-rate",
    method: "patch",
    path: "/api/currency-rates/{rateId}",
    summary: "Mettre a jour un taux de change",
    description: "Met a jour au moins une propriete du taux cible.",
    tags: ["Parametres"],
    pathParameters: [{ name: "rateId", schema: uuidSchema, description: "Identifiant du taux." }],
    body: { schema: currencyRatePatchSchema, description: "Champs du taux a modifier." },
  },
  {
    id: "delete-currency-rate",
    method: "delete",
    path: "/api/currency-rates/{rateId}",
    summary: "Desactiver un taux de change",
    description: "Supprime logiquement le taux cible dans le tenant autorise.",
    tags: ["Parametres"],
    pathParameters: [{ name: "rateId", schema: uuidSchema, description: "Identifiant du taux." }],
    queryParameters: [{ name: "tenant_id", schema: uuidSchema, description: "Tenant cible." }],
  },
  {
    id: "list-feature-flags",
    method: "get",
    path: "/api/feature-flags",
    summary: "Lister les feature flags",
    description: "Liste les feature flags du tenant autorise.",
    tags: ["Administration"],
    queryParameters: [
      { name: "tenant_id", schema: uuidSchema, description: "Tenant cible." },
      { name: "include_inactive", schema: z.boolean(), description: "Inclut les flags inactifs." },
    ],
  },
  {
    id: "patch-feature-flag",
    method: "patch",
    path: "/api/feature-flags",
    summary: "Basculer un feature flag",
    description: "Active, desactive ou renseigne la valeur d'un feature flag du tenant.",
    tags: ["Administration"],
    body: { schema: featureFlagPatchSchema, description: "Cle, etat et valeur optionnelle du flag." },
  },
  {
    id: "list-indices",
    method: "get",
    path: "/api/indices",
    summary: "Lister les indices materiaux",
    description: "Retourne les indices materiaux selon recherche et limite.",
    tags: ["Catalogue"],
    queryParameters: [
      { name: "search", schema: z.string(), description: "Recherche textuelle." },
      { name: "limit", schema: z.number().int().positive().max(1000), description: "Nombre maximal d'indices." },
    ],
  },
  {
    id: "mutate-indices",
    method: "post",
    path: "/api/indices",
    summary: "Modifier les indices materiaux",
    description: "Cree, met a jour, supprime ou importe en lot des indices.",
    tags: ["Catalogue"],
    body: { schema: indicesActionSchema, description: "Action indices discriminee." },
    success: [
      { status: "200", description: "Action indices executee." },
      { status: "201", description: "Indice cree." },
    ],
  },
  {
    id: "list-mappings",
    method: "get",
    path: "/api/mappings",
    summary: "Lister les mappings DPGF",
    description: "Retourne les mappings et templates accessibles.",
    tags: ["Imports"],
    queryParameters: [
      { name: "import_id", schema: uuidSchema, description: "Import cible optionnel." },
      { name: "limit", schema: z.number().int().positive().max(200), description: "Nombre maximal de mappings." },
    ],
  },
  {
    id: "mutate-mappings",
    method: "post",
    path: "/api/mappings",
    summary: "Previsualiser ou enregistrer un mapping",
    description: "Execute l'action de mapping DPGF discriminee demandee.",
    tags: ["Imports"],
    body: { schema: mappingsActionSchema, description: "Action et donnees du mapping." },
    success: [
      { status: "200", description: "Action de lecture ou validation executee." },
      { status: "201", description: "Mapping ou template cree." },
    ],
  },
  {
    id: "create-margin-tier",
    method: "post",
    path: "/api/margin-tiers",
    summary: "Creer une tranche de marge",
    description: "Ajoute une tranche au bareme de marge du tenant.",
    tags: ["Parametres"],
    body: { schema: createMarginTierSchema, description: "Seuil, multiplicateur et position." },
    success: [{ status: "201", description: "Tranche creee." }],
  },
  {
    id: "patch-margin-tier",
    method: "patch",
    path: "/api/margin-tiers/{tierId}",
    summary: "Modifier une tranche de marge",
    description: "Met a jour une tranche du bareme de marge.",
    tags: ["Parametres"],
    pathParameters: [{ name: "tierId", schema: uuidSchema, description: "Identifiant de la tranche." }],
    body: { schema: updateMarginTierSchema, description: "Champs de tranche a modifier." },
  },
  {
    id: "delete-margin-tier",
    method: "delete",
    path: "/api/margin-tiers/{tierId}",
    summary: "Supprimer une tranche de marge",
    description: "Supprime une tranche du bareme de marge.",
    tags: ["Parametres"],
    pathParameters: [{ name: "tierId", schema: uuidSchema, description: "Identifiant de la tranche." }],
  },
];

const importAndMembershipContracts: RouteContract[] = [
  {
    id: "list-imports",
    method: "get",
    path: "/api/imports",
    summary: "Lister les imports DPGF",
    description: "Retourne les imports accessibles, avec filtre affaire optionnel.",
    tags: ["Imports"],
    queryParameters: [
      { name: "project_id", schema: uuidSchema, description: "Affaire cible (nom canonique)." },
      { name: "projectId", schema: uuidSchema, description: "Alias camelCase de `project_id`." },
    ],
  },
  {
    id: "create-import",
    method: "post",
    path: "/api/imports",
    summary: "Creer un import DPGF",
    description:
      "Converge un payload JSON ou un fichier tabulaire multipart vers le pipeline d'import canonique.",
    tags: ["Imports"],
    body: {
      schema: importJsonSchema,
      description: "Lignes JSON ou tables PDF approuvees.",
      alternates: [
        { schema: importMultipartSchema, contentType: "multipart/form-data" },
      ],
    },
    success: [{ status: "201", description: "Import cree." }],
    extraErrors: [{ status: "415", description: "Content-Type non supporte." }],
  },
  {
    id: "review-tabular-pdf",
    method: "post",
    path: "/api/imports/tabular-pdf/review",
    summary: "Revoir des tables PDF extraites",
    description: "Construit la revue tabulaire sans persistance depuis les tables extraites.",
    tags: ["Imports"],
    body: { schema: tabularPdfReviewSchema, description: "Tables PDF et provenance source." },
  },
  {
    id: "review-tabular-pdf-file",
    method: "post",
    path: "/api/imports/tabular-pdf/review-file",
    summary: "Extraire et revoir un fichier PDF tabulaire",
    description: "Extrait les tables d'un PDF fourni puis retourne une revue sans persistance.",
    tags: ["Imports"],
    body: {
      schema: tabularPdfReviewFileSchema,
      description: "PDF source et identifiant documentaire optionnel.",
      contentType: "multipart/form-data",
    },
  },
  {
    id: "list-memberships",
    method: "get",
    path: "/api/memberships",
    summary: "Lister les membres du tenant",
    description: "Retourne les membres du tenant courant selon la recherche optionnelle.",
    tags: ["Administration"],
    queryParameters: [
      { name: "search", schema: z.string().max(120), description: "Recherche de membre." },
    ],
  },
  {
    id: "create-membership",
    method: "post",
    path: "/api/memberships",
    summary: "Ajouter un membre au tenant",
    description: "Cree un membership avec le role demande.",
    tags: ["Administration"],
    body: { schema: createMembershipSchema, description: "Utilisateur et role a attribuer." },
    success: [{ status: "201", description: "Membership cree." }],
  },
  {
    id: "patch-membership",
    method: "patch",
    path: "/api/memberships/{membershipId}",
    summary: "Modifier le role d'un membre",
    description: "Met a jour le role du membership cible.",
    tags: ["Administration"],
    pathParameters: [{ name: "membershipId", schema: uuidSchema, description: "Identifiant du membership." }],
    body: { schema: updateMembershipSchema, description: "Nouveau role du membre." },
  },
  {
    id: "delete-membership",
    method: "delete",
    path: "/api/memberships/{membershipId}",
    summary: "Retirer un membre du tenant",
    description: "Supprime le membership cible sous controle administrateur.",
    tags: ["Administration"],
    pathParameters: [{ name: "membershipId", schema: uuidSchema, description: "Identifiant du membership." }],
  },
  {
    id: "list-tenant-memberships",
    method: "get",
    path: "/api/tenants/memberships",
    summary: "Administrer les memberships du tenant actif",
    description: "Retourne le tenant actif et ses memberships enrichis des profils.",
    tags: ["Administration"],
  },
  {
    id: "mutate-tenant-membership",
    method: "post",
    path: "/api/tenants/memberships",
    summary: "Changer un role ou le tenant par defaut",
    description: "Execute l'action administrative `set-role` ou `set-default`.",
    tags: ["Administration"],
    body: { schema: tenantMembershipActionSchema, description: "Action de membership du tenant actif." },
  },
];

const directoryAndOrdersContracts: RouteContract[] = [
  {
    id: "mutate-products",
    method: "post",
    path: "/api/products",
    summary: "Creer ou mettre a jour un produit",
    description:
      "Cree un article du referentiel ou met a jour ses champs, y compris l'archivage.",
    tags: ["Catalogue"],
    body: { schema: productActionSchema, description: "Action produit discriminee." },
    success: [
      { status: "200", description: "Produit mis a jour." },
      { status: "201", description: "Produit cree." },
    ],
  },
  {
    id: "list-suppliers",
    method: "get",
    path: "/api/suppliers",
    summary: "Lister les fournisseurs",
    description:
      "Retourne les fournisseurs actifs ou le nombre de bons de commande lies.",
    tags: ["Catalogue"],
    queryParameters: [
      { name: "view", schema: z.enum(["list", "usage"]), description: "Vue liste ou usage." },
      { name: "id", schema: uuidSchema, description: "Identifiant fournisseur pour la vue usage." },
    ],
  },
  {
    id: "mutate-suppliers",
    method: "post",
    path: "/api/suppliers",
    summary: "Creer, modifier ou supprimer un fournisseur",
    description:
      "Cree ou met a jour un fournisseur, ou le supprime / archive selon les commandes liees.",
    tags: ["Catalogue"],
    body: { schema: supplierActionSchema, description: "Action fournisseur discriminee." },
    success: [
      { status: "200", description: "Fournisseur mis a jour ou retire." },
      { status: "201", description: "Fournisseur cree." },
    ],
  },
  {
    id: "list-orders",
    method: "get",
    path: "/api/orders",
    summary: "Lister les bons de commande",
    description:
      "Assemble cote serveur les commandes, leurs relations et, en option, les lignes.",
    tags: ["Achats"],
    queryParameters: [
      { name: "view", schema: z.enum(["list", "items"]), description: "Vue liste ou lignes." },
      {
        name: "order_id",
        schema: z.array(uuidSchema),
        description: "Identifiants de commande pour la vue lignes.",
      },
    ],
  },
];

const estimateEmailDispatchContracts: RouteContract[] = [
  {
    id: "reconcile-estimate-email-dispatch",
    method: "post",
    path: "/api/estimates/{versionId}/email-dispatch/reconcile",
    summary: "Rapprocher un envoi email de devis",
    description:
      "Marque un dispatch email inconnu ou en echec comme envoye ou echoue apres rapprochement manuel.",
    tags: ["Estimate Versions"],
    pathParameters: [
      {
        name: "versionId",
        schema: uuidSchema,
        description: "Identifiant de la version de devis.",
      },
    ],
    body: {
      schema: z.object({
        dispatchId: uuidSchema,
        resolution: z.enum(["sent", "failed"]),
      }),
      description: "Identifiant du dispatch et resolution manuelle.",
    },
  },
];

export const baseAdditionalOpenApiOperationsRegistry: OpenApiOperationDefinition[] = [
  ...administrationContracts,
  ...importAndMembershipContracts,
  ...directoryAndOrdersContracts,
  ...estimateEmailDispatchContracts,
].map(buildOpenApiRouteOperation);
