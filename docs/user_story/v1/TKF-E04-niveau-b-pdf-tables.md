# TKF-E04 — Niveau B : Extraction PDF Schedules

> Phase: 2 | Priorite: P1 | Statut: Termine (fichier fini)

## Objectif

Implementer le Niveau B du takeoff : upload et gestion de plans/PDF, extraction de tableaux
structures (nomenclatures, metrages, schedules de finitions) via Gemini Vision, et interface
de review dediee avec vue par tables et groupement par page.

## Ce qui existe deja

- **Pipeline Niveau A complet** : TKF-E01 + TKF-E02 — schema DB, SDK Gemini, traitement,
  review, apply.
- **Wrapper Gemini** : `src/lib/takeoff/gemini-client.ts` — `callGeminiStructured()` avec
  support fichiers et vision.
- **Schema Zod** : `src/lib/takeoff/schemas.ts` — `TakeoffExchangeSchema` avec champ `tables`.
- **Prompts** : `src/lib/takeoff/prompts.ts` — prompt Niveau B (extraction tableaux PDF).
- **Validation fichiers** : `src/lib/file-validation.ts` — a etendre pour PDF.
- **Storage Supabase** : bucket `takeoff-files` existant.

---

## TKF-017 — Tables plan_files, plan_sets + bucket Storage plan-files

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux que le systeme gere un catalogue de plans et fichiers PDF
> organises en sets, afin de pouvoir lancer des extractions sur des plans specifiques ou
> des lots de documents.

### Criteres d'acceptation

- [ ] Migration idempotente cree:
  - `plan_sets` (tenant scoped)
  - `plan_files` (tenant scoped) avec FK et cascade suppression
- [ ] `plan_files` inclut metadata minimales:
  - `file_path`, `file_name`, `file_type`, `file_size_bytes`, `page_count`
  - `file_hash` (dedup), `metadata` json
- [ ] Bucket `plan-files` cree avec policies tenant-scoped (upload/read/delete)
- [ ] RLS activee sur `plan_sets` et `plan_files`, bloque tout cross-tenant
- [ ] Index minimaux:
  - `plan_sets(tenant_id, estimate_id, created_at desc)`
  - `plan_files(tenant_id, plan_set_id, created_at desc)`
  - `plan_files(file_hash)` pour dedup optionnelle
- [ ] Tests SQL couvrent RLS + cascade DB + coherence du Storage path

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/xxx_takeoff_plans.sql`
- Reutiliser :
  - Pattern RLS et Storage policies existants
  - Fonctions DB `current_tenant_id()`, `is_tenant_member()`
- Dependances : TKF-001

---

## TKF-018 — API CRUD plans et plan sets (upload, list, delete)

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux uploader, lister et supprimer des plans et des sets de plans
> via l'API, afin de gerer mon catalogue de documents de reference.

### Criteres d'acceptation

- [ ] Endpoints `plan-sets` et `plan-files` implementes avec validation Zod stricte
- [ ] Upload PDF:
  - accepte uniquement `application/pdf`
  - taille max 50 Mo
  - chemin storage `{tenant_id}/{set_id}/{file_id}/{filename}`
- [ ] Support signed URLs:
  - URL signee upload court terme
  - URL signee download pour consultation
- [ ] Suppression set:
  - supprime DB + objets Storage associes
  - operation atomique ou compensation explicite en cas d'echec partiel
- [ ] Verification tenant scope sur toutes les routes (`403/404` normalises)
- [ ] Endpoints documentes OpenAPI (passe `validate-openapi`)
- [ ] Tests integration couvrent upload/list/delete + erreurs 400/403/404/413

### Notes techniques

- Fichiers a creer :
  - `src/app/api/takeoff/plan-sets/route.ts`
  - `src/app/api/takeoff/plan-sets/[setId]/route.ts`
  - `src/app/api/takeoff/plan-sets/[setId]/files/route.ts`
  - `src/app/api/takeoff/plan-sets/[setId]/files/[fileId]/route.ts`
- Reutiliser :
  - `src/lib/file-validation.ts` — etendre pour PDF
  - `src/lib/estimates/errors.ts` — gestion erreurs
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()`
- Dependances : TKF-017

---

## TKF-019 — UI Plan Center (upload, metadonnees, organisation)

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux une interface dediee pour uploader et organiser mes plans
> en sets, afin de preparer les documents avant de lancer des extractions Niveau B ou C.

### Criteres d'acceptation

- [ ] Page Plan Center livre:
  - liste des sets + compteurs fichiers
  - creation/edition/suppression set
  - liste fichiers avec metadonnees (`name`,`size`,`type`,`page_count`)
- [ ] Upload multi-fichiers PDF avec progression individuelle + erreurs par fichier
- [ ] Validation client coherente serveur (type/taille)
- [ ] Actions utilisateur:
  - supprimer fichier
  - supprimer set (confirmation)
  - lancer extraction niveau B avec set preselectionne
- [ ] UX resiliente:
  - etat vide
  - etat chargement
  - etat erreur API
- [ ] Tests UI couvrent flux nominal, echec upload, suppression confirmee

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/estimates/[versionId]/plans/page.tsx`
  - `src/components/takeoff/PlanCenter.tsx`
  - `src/components/takeoff/PlanFileCard.tsx`
  - `src/components/takeoff/PlanSetManager.tsx`
- Reutiliser :
  - `src/lib/takeoff/client.ts` — wrappers API plans
  - Patterns UI existants
- Dependances : TKF-018

---

## TKF-020 — Traitement job Niveau B (extraction tables Gemini Vision)

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux lancer une extraction Niveau B sur un PDF pour en
> extraire automatiquement les tableaux structures (nomenclatures, schedules, metrages),
> afin d'accelerer la saisie des donnees de reference.

### Criteres d'acceptation

- [ ] `processLevelB(jobId)` implemente:
  1. chargement PDF (ou pages) depuis Storage
  2. appel Gemini Vision prompt B
  3. validation schema `tables`
  4. persistence `takeoff_results` + `takeoff_items`
  5. transition job `processing -> completed|failed`
- [ ] Chaque table extraite persiste:
  - `name`, `headers[]`, `rows[][]`, `page`
  - warnings associes si table partielle
- [ ] Gestion multi-pages:
  - extraction page par page ou chunk configurable
  - metadata page source conservee
- [ ] Metriques persistees:
  - `token_count`, `cost_cents`, `duration_ms`, `tables_count`
- [ ] Erreurs Gemini/schema stockent `raw_response` et `error_message`
- [ ] Tests integration couvrent PDF simple, PDF multi-pages, reponse invalide, timeout

### Notes techniques

- Fichiers a creer / modifier :
  - `src/lib/takeoff/processor.ts` — ajouter `processLevelB()`
- Reutiliser :
  - `src/lib/takeoff/gemini-client.ts` — `callGeminiStructured()` avec fichiers
  - `src/lib/takeoff/prompts.ts` — prompt Niveau B
  - `src/lib/takeoff/schemas.ts` — schema tables
- Dependances : TKF-002, TKF-003, TKF-004, TKF-006, TKF-017, TKF-018

---

## TKF-021 — UI Review Niveau B (vue tables + groupements + filtre page)

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux examiner les tableaux extraits d'un PDF avec une vue
> organisee par table et par page, afin de valider les structures detectees avant
> application au devis.

### Criteres d'acceptation

- [ ] Page review niveau B expose 2 vues:
  - `Tables` (structure source)
  - `Items` (aplatis pour apply)
- [ ] Filtres fonctionnels:
  - par page
  - par table
  - par statut inclusion/exclusion
- [ ] Actions:
  - exclusion table entiere
  - edition cellule/table
  - synchronisation vers items aplatis
- [ ] Compteurs coherents:
  - `tables_count`, `items_count`, `included`, `excluded`
- [ ] Lien apply reutilise wizard TKF-013 avec donnees B
- [ ] Tests UI couvrent bascule onglets, filtres, edition et exclusion table

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/TakeoffTableView.tsx`
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/review/page.tsx` —
    ajout mode vue tables
- Reutiliser :
  - `src/components/takeoff/TakeoffReviewTable.tsx` — base commune
  - `src/components/takeoff/TakeoffApplyWizard.tsx` — apply reutilise
- Dependances : TKF-012, TKF-019, TKF-020
