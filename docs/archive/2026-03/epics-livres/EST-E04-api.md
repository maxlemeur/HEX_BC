# EST-E04 — API (Route Handlers + Zod)

> Milestone: M0 | Priorite: P1 | Statut: A faire

## Objectif

Completer et durcir la couche API REST du module de chiffrage : ajouter l'export
streaming pour les gros devis, les operations batch pour reduire la latence,
et la documentation OpenAPI pour faciliter les integrations tierces. Cette epic
garantit que l'API est robuste, performante et auto-documentee.

## Ce qui existe deja

Les sprints BC-002 et BC-005 ont livre la couche API suivante :

- **12 route handlers REST** sous `src/app/api/estimates/` :
  - `route.ts` — GET liste des devis, POST creation
  - `[versionId]/route.ts` — GET details version, PATCH mise a jour
  - `[versionId]/status/route.ts` — PATCH transition de statut
  - `[versionId]/items/route.ts` — GET items, POST creation item
  - `[versionId]/items/bulk/route.ts` — PUT bulk update
  - `[versionId]/items/reorder/route.ts` — POST reordonnancement
  - `[versionId]/duplicate/route.ts` — POST duplication version
  - `[versionId]/categories/route.ts` — POST creation categorie
  - `[versionId]/labor-roles/route.ts` — POST creation role MO
  - `[versionId]/labor-roles/[roleId]/route.ts` — PATCH mise a jour role
  - `[versionId]/suggestion-rules/route.ts` — POST creation regle
  - `[versionId]/suggestion-rules/[ruleId]/route.ts` — PATCH mise a jour regle
- **Validation Zod** : `src/lib/estimates/schemas.ts` — 14 schemas couvrant
  toutes les mutations (create, patch, bulk, reorder, categories, roles, rules)
- **Erreurs normalisees** : `src/lib/estimates/errors.ts` — `ApiError` class,
  helpers `ok()`, `badRequest()`, `unauthorized()`, `forbidden()`, `notFound()`,
  `conflict()`, `internalError()`, `toErrorResponse()`, codes HTTP corrects,
  `mapSupabaseError()` pour traduire les erreurs Postgres/RLS
- **RPCs atomiques** :
  - `bulk_update_estimate_items(...)` — mise a jour groupee transactionnelle
  - `reorder_estimate_items(...)` — reordonnancement atomique
  - `snapshot_estimate_item_bulk_updates(...)` — audit des operations bulk
- **Controle d'acces tenant** : toutes les routes verifient `tenant_id` et
  le role du membre (`admin`, `engineer`, `viewer`) via `has_tenant_role()`

---

## EST-064 — Streaming export endpoint

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux exporter un devis volumineux (500+ lignes) sans
> timeout via un endpoint streaming, afin de telecharger des fichiers Excel ou PDF
> de gros devis sans que la requete echoue.

### Criteres d'acceptation

- [ ] Endpoint GET `/api/estimates/[versionId]/export?format=xlsx` qui retourne
      un `ReadableStream` (chunked transfer encoding)
- [ ] Support du format `xlsx` (Excel) en premiere iteration, via la librairie
      `exceljs` en mode streaming (workbook.stream)
- [ ] Support du format `pdf` en seconde iteration (P2)
- [ ] En-tete `Content-Disposition: attachment; filename="devis-{reference}-v{n}.xlsx"`
- [ ] En-tete custom `X-Export-Progress` envoye periodiquement (optionnel,
      pour les clients qui supportent le streaming SSE)
- [ ] Timeout-safe : la generation streaming ne bloque pas le worker Node.js,
      meme pour des devis de 1000+ lignes
- [ ] Le fichier Excel contient :
  - Feuille "Devis" : sections et lignes avec colonnes (poste, designation,
    unite, quantite, PU HT, total HT, TVA, total TTC)
  - Feuille "Resume" : totaux HT, remise, TVA, TTC, parametres du devis
  - Mise en forme : en-tetes colores, sections en gras, montants formates
- [ ] Controle d'acces : seuls les membres du tenant avec role `admin` ou
      `engineer` peuvent exporter (viewer ne voit que le print)
- [ ] Tests : export d'un devis vide (0 lignes), d'un devis standard (50 lignes),
      d'un gros devis (500 lignes), verification du format et des totaux

### Notes techniques

- Fichiers a creer :
  - `src/app/api/estimates/[versionId]/export/route.ts` — GET handler
    avec `ReadableStream` response
  - `src/lib/estimates/export-stream.ts` — logique de generation Excel
    streaming : `streamEstimateToExcel(version, items, stream)`,
    `streamEstimateToPdf(version, items, stream)` (futur)
- Fichiers a modifier :
  - `src/lib/estimates/client.ts` — wrapper `exportEstimate(versionId, format)`
    qui retourne un `Blob` ou un `ReadableStream`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — bouton
    "Exporter Excel" avec indicateur de progression
- Reutiliser :
  - `src/lib/estimates/server.ts` — `getEstimateVersionDetails()` et
    `listEstimateItems()` pour recuperer les donnees
  - `src/lib/money.ts` — `formatEUR()` (ou `formatCurrency()` si EST-027
    est fait) pour le formatage des montants dans le fichier
  - `src/lib/estimates/errors.ts` — `forbidden()`, `notFound()`,
    `toErrorResponse()`
  - `src/lib/estimate-calculations.ts` — `computeReadOnlyTotals()`
    pour verifier les totaux avant export
- Dependances externes : `exceljs` (a ajouter aux dependencies npm)
- Dependances internes : aucune

---

## EST-065 — OpenAPI/Swagger documentation

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que developpeur, je veux une documentation OpenAPI auto-generee pour
> les endpoints du module de chiffrage, afin d'integrer facilement avec d'autres
> systemes (ERP, outils tiers) et d'accelerer l'onboarding des nouveaux
> developpeurs.

### Criteres d'acceptation

- [ ] Specification OpenAPI 3.1 generee automatiquement depuis les schemas
      Zod existants (`src/lib/estimates/schemas.ts`)
- [ ] Chaque endpoint documente avec :
  - Methode HTTP et path
  - Description en francais
  - Schema du body (request) derive du schema Zod
  - Schema de la reponse (success + erreurs)
  - Parametres de path et query
  - Codes HTTP possibles (200, 400, 401, 403, 404, 409, 500)
- [ ] Interface Swagger UI accessible a `/api/docs` (ou `/api/estimates/docs`)
      en mode developpement et staging (desactivee en production sauf feature flag)
- [ ] Validation CI : la spec OpenAPI est regeneree a chaque build et un
      test verifie qu'elle est valide et a jour
- [ ] Fichier `openapi.json` exporte pour import dans Postman, Insomnia ou
      autres clients API
- [ ] Les schemas Zod existants ne sont pas dupliques : la generation utilise
      `zod-to-openapi` ou equivalent pour convertir les schemas

### Notes techniques

- Fichiers a creer :
  - `src/lib/openapi/generate.ts` — logique de generation de la spec
    OpenAPI depuis les schemas Zod, mapping routes -> operations
  - `src/lib/openapi/registry.ts` — registre des endpoints avec metadata
    (descriptions, exemples, tags)
  - `src/app/api/docs/route.ts` — GET handler qui sert la spec JSON
    et/ou le HTML Swagger UI
  - `scripts/validate-openapi.ts` — script CI pour validation
- Fichiers a modifier :
  - `src/lib/estimates/schemas.ts` — ajout d'annotations `.openapi()`
    si utilisation de `@asteasolutions/zod-to-openapi`
  - `package.json` — ajout des dependances (`zod-to-openapi`,
    `swagger-ui-dist` ou `swagger-ui-react`)
- Reutiliser :
  - `src/lib/estimates/schemas.ts` — tous les schemas Zod existants
    (14 schemas) comme source de verite
  - `src/lib/estimates/errors.ts` — codes d'erreur pour documenter
    les reponses d'erreur
  - Structure des route handlers dans `src/app/api/estimates/` comme
    reference pour les paths et methodes
- Dependances externes : `@asteasolutions/zod-to-openapi`, `swagger-ui-dist`
- Dependances internes : aucune

---

## EST-066 — Batch operations API

**Priorite:** P2 | **Effort:** L

### User Story

> En tant que chiffreur, je veux envoyer plusieurs operations en une seule requete
> (creation + mise a jour + suppression de lignes), afin de reduire la latence
> lors d'editions complexes et d'ameliorer la reactivite de l'editeur.

### Criteres d'acceptation

- [ ] Endpoint POST `/api/estimates/[versionId]/batch` acceptant un tableau
      d'operations :
      ```json
      {
        "operations": [
          { "op": "create", "data": { ... } },
          { "op": "update", "id": "xxx", "data": { ... } },
          { "op": "delete", "id": "xxx" },
          { "op": "reorder", "data": { "item_ids": [...] } }
        ],
        "concurrency_token": "2025-01-15T10:30:00Z"
      }
      ```
- [ ] Execution transactionnelle : toutes les operations reussissent ou
      aucune n'est appliquee (rollback complet en cas d'echec)
- [ ] Verification du `concurrency_token` (EST-044) avant execution du batch
- [ ] Reponse structuree avec le resultat de chaque operation :
      ```json
      {
        "results": [
          { "index": 0, "status": "ok", "data": { ... } },
          { "index": 1, "status": "error", "code": "VALIDATION_ERROR", "message": "..." }
        ],
        "committed": false
      }
      ```
- [ ] Mode "dry-run" optionnel (`?dry_run=true`) : valide toutes les operations
      sans les executer, retourne les erreurs potentielles
- [ ] Schema Zod pour la validation du batch : `batchOperationsSchema` avec
      validation de chaque operation individuelle via les schemas existants
- [ ] Limite configurable du nombre d'operations par batch (defaut : 100)
- [ ] Audit trail : une seule entree `audit_logs` par batch avec le detail
      des operations dans `new_data`
- [ ] Tests unitaires : batch vide (400), batch valide (200), batch avec
      erreur partielle (rollback), dry-run, depassement de limite,
      conflit de concurrence (409)

### Notes techniques

- Fichiers a creer :
  - `src/app/api/estimates/[versionId]/batch/route.ts` — POST handler
  - `src/lib/estimates/batch.ts` — logique d'orchestration du batch :
    `executeBatch(versionId, operations, token)`, validation,
    execution transactionnelle via RPC ou transaction Supabase
  - Schema `batchOperationsSchema` dans `src/lib/estimates/schemas.ts`
    ou fichier dedie `src/lib/estimates/batch-schema.ts`
- Fichiers a modifier :
  - `src/lib/estimates/server.ts` — potentiellement extraire les operations
    unitaires (create/update/delete) en fonctions reutilisables par le batch
  - `src/lib/estimates/client.ts` — wrapper `batchEstimateOperations()`
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — utiliser
    le batch pour les sauvegardes groupees (debounce + batch)
- Reutiliser :
  - `src/lib/estimates/schemas.ts` — `createEstimateItemSchema`,
    `updateEstimateItemSchema`, `deleteEstimateItemSchema`,
    `reorderEstimateItemsSchema` pour la validation de chaque operation
  - `src/lib/estimates/errors.ts` — `badRequest()`, `conflict()`,
    `toErrorResponse()`
  - `src/lib/estimates/server.ts` — `createEstimateItem()`,
    `updateEstimateItem()`, `deleteEstimateItem()`, `reorderEstimateItems()`
    comme operations unitaires
  - RPC `bulk_update_estimate_items` comme reference pour l'execution
    transactionnelle
- Dependances internes : EST-044 (concurrence optimiste requise pour le
  `concurrency_token` du batch)
