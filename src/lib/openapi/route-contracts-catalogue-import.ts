import { z } from "zod";

import {
  costingWorkbookSuggestionProvidersResponseSchema,
  costingWorkbookSuggestionsRequestSchema,
  costingWorkbookSuggestionsResponseSchema,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import {
  bulkProductsSchema,
  createSupplierAliasSchema,
  pendingSupplierReferencePageSchema,
  PENDING_REFERENCE_PAGE_SIZES,
  reviewReferencesSchema,
} from "@/lib/catalogue/import-review-contract";
import { successResponseSchemaDefinition } from "@/lib/openapi/registry-helpers";
import type { RouteContract } from "@/lib/openapi/route-contracts";

const uuidSchema = z.string().uuid();

export const catalogueImportContracts: RouteContract[] = [
  {
    id: "list-supplier-aliases",
    method: "get",
    path: "/api/catalogue/supplier-aliases",
    summary: "Lister les noms associés aux fournisseurs",
    description:
      "Noms que le classeur de chiffrage écrit pour un fournisseur du catalogue (TI-711). Lisible par tout membre de l’entreprise active.",
    tags: ["Catalogue"],
  },
  {
    id: "create-supplier-alias",
    method: "post",
    path: "/api/catalogue/supplier-aliases",
    summary: "Associer un nom du classeur à un fournisseur",
    description:
      "Mémorise le nom que le classeur écrit pour un fournisseur actif de l’entreprise : les aperçus suivants le lisent comme ce fournisseur, y compris entre des fournisseurs homonymes. Redemander la même association répond celle qui existe ; un nom déjà associé à un autre fournisseur est refusé (409). Réservé aux administrateurs et aux ingénieurs.",
    tags: ["Catalogue"],
    body: { schema: createSupplierAliasSchema, description: "Fournisseur et nom à lui associer." },
    success: [{ status: "201", description: "Association mémorisée." }],
  },
  {
    id: "delete-supplier-alias",
    method: "delete",
    path: "/api/catalogue/supplier-aliases/{aliasId}",
    summary: "Retirer un nom associé à un fournisseur",
    description: "Un administrateur retire toute association ; un ingénieur, celles qu’il a créées.",
    tags: ["Catalogue"],
    pathParameters: [{ name: "aliasId", schema: uuidSchema, description: "Identifiant UUID de l’association." }],
  },
  {
    id: "list-pending-supplier-references",
    method: "get",
    path: "/api/catalogue/supplier-references",
    summary: "Lister les références fournisseur à vérifier",
    description:
      "Références importées et pas encore vérifiées, les plus récentes d’abord, avec leur article et leur fournisseur. can_review dit si l’appelant peut vérifier la référence (droits de modification de l’article).",
    tags: ["Catalogue"],
    queryParameters: [
      { name: "page", schema: z.number().int().min(1), description: "Page, à partir de 1." },
      { name: "size", schema: z.union(PENDING_REFERENCE_PAGE_SIZES.map((size) => z.literal(size))), description: "Références par page." },
      { name: "supplier_id", schema: uuidSchema, description: "Références de ce fournisseur." },
      { name: "import_batch_id", schema: uuidSchema, description: "Références de cet import." },
      { name: "q", schema: z.string().max(100), description: "Partie du code fournisseur." },
    ],
    success: [{
      status: "200", description: "Page et empreinte de la sélection filtrée complète.",
      schema: successResponseSchemaDefinition("ApiPendingSupplierReferencePage", pendingSupplierReferencePageSchema),
    }],
  },
  {
    id: "review-supplier-references",
    method: "post",
    path: "/api/catalogue/supplier-references",
    summary: "Vérifier des références fournisseur ensemble",
    description:
      "Valide (elles servent alors aux achats telles qu’importées) ou retire les références nommées, ou toutes celles à vérifier que le filtre désigne. Ce que l’appelant ne peut pas vérifier (article d’un autre pour un ingénieur sans la base partagée, article ou fournisseur archivé) est laissé en attente et compté dans skipped. Réservé aux administrateurs et aux ingénieurs.",
    tags: ["Catalogue"],
    body: { schema: reviewReferencesSchema, description: "Action et références nommées, ou filtre accompagné du nombre confirmé et de l’empreinte de sélection renvoyée par la liste." },
    extraErrors: [{ status: "409", description: "L’empreinte est absente ou la sélection a changé depuis sa lecture. Actualisez la liste." }],
  },
  {
    id: "bulk-update-products",
    method: "post",
    path: "/api/products/bulk",
    summary: "Valider des brouillons ou donner un type de fourniture à plusieurs articles",
    description:
      "validate : valide les brouillons complets parmi les articles nommés ou ceux d’un import (réservé aux administrateurs) ; un brouillon incomplet reste un brouillon et est compté. assign-supply-type : donne un type de fourniture de l’entreprise aux articles nommés que l’appelant peut modifier.",
    tags: ["Catalogue"],
    body: { schema: bulkProductsSchema, description: "Action sur plusieurs articles." },
  },
  {
    id: "list-catalogue-import-batches",
    method: "get",
    path: "/api/catalogue/import-batches",
    summary: "Lister les imports récents du classeur de chiffrage",
    description:
      "Les dix derniers imports de l’entreprise active, avec ce qu’ils ont créé qui existe encore (total) et ce qui reste à valider ou à vérifier (open). can_undo dit si l’appelant peut annuler l’import.",
    tags: ["Catalogue"],
  },
  {
    id: "undo-catalogue-import-batch",
    method: "post",
    path: "/api/catalogue/import-batches/{batchId}/undo",
    summary: "Annuler un import du classeur de chiffrage",
    description:
      "Supprime ce que l’import a créé et que personne n’a touché depuis : brouillons non validés et non utilisés, références encore à vérifier. Le reste est conservé et compté. Réservé à un administrateur ou à l’auteur de l’import.",
    tags: ["Catalogue"],
    pathParameters: [{ name: "batchId", schema: uuidSchema, description: "Identifiant UUID de l’import." }],
  },
  {
    id: "read-workbook-suggestion-providers",
    method: "get",
    path: "/api/catalogue/workbook-import/suggestions",
    summary: "Lire les sources d’IA disponibles pour les propositions de l’import",
    description:
      "Dit lesquelles des sources (forfait ChatGPT, clé API OpenAI personnelle, API Decisions) ce membre peut interroger ici. Aucun fournisseur d’IA n’est appelé.",
    tags: ["Catalogue"],
    success: [{
      status: "200", description: "Disponibilité des sources de propositions.",
      schema: successResponseSchemaDefinition("ApiCostingWorkbookSuggestionProviders", costingWorkbookSuggestionProvidersResponseSchema),
    }],
  },
  {
    id: "suggest-for-workbook-import",
    method: "post",
    path: "/api/catalogue/workbook-import/suggestions",
    summary: "Proposer des corrections pour l’import du classeur de chiffrage",
    description:
      "Propose, pour une tâche (fournisseurs, articles, types de fourniture, colonnes, codes fournisseur), ce que les règles trouvent ; avec provider, la source d’IA choisie arbitre seulement ce que les règles laissent indécis, parmi leurs candidats ou « aucun ». Rien n’est écrit : une proposition s’applique quand le bureau la retient à l’écran. Aucun repli d’une source vers une autre. Réservé aux administrateurs et aux ingénieurs.",
    tags: ["Catalogue"],
    body: { schema: costingWorkbookSuggestionsRequestSchema, description: "Tâche, éléments à proposer et source d’IA éventuelle." },
    success: [{
      status: "200", description: "Propositions pour la tâche demandée.",
      schema: successResponseSchemaDefinition("ApiCostingWorkbookSuggestions", costingWorkbookSuggestionsResponseSchema),
    }],
  },
];
