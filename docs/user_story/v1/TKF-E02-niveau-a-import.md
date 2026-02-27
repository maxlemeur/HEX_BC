# TKF-E02 — Niveau A : Import Normaliseur Universel

> Phase: 1 (MVP) | Priorite: P0 | Statut: Termine (fichier fini)

## Objectif

Implementer le pipeline complet du Niveau A : upload de fichiers CSV/Excel, normalisation
via Gemini AI, review humaine des items extraits, et application au devis. C'est le coeur
du MVP Takeoff — le flux de bout en bout qui valide l'architecture.

## Ce qui existe deja

- **Schema DB takeoff** : tables `takeoff_jobs`, `takeoff_results`, `takeoff_items`
  (TKF-001)
- **Schema Zod TakeoffExchange** : validation structuree des reponses Gemini (TKF-002)
- **Wrapper Gemini** : `callGeminiStructured()` (TKF-003)
- **Prompts Niveau A** : prompt d'extraction CSV/Excel (TKF-004)
- **Couche serveur estimates** : `src/lib/estimates/server.ts` —
  `getAuthenticatedContext()`, `createEstimateItem()`, `assertDraftStatus()`,
  `bulkUpdateEstimateItems()`, `insertAssemblyIntoVersion()`
- **Validation fichiers** : `src/lib/file-validation.ts` — `validateFileForUpload()`
- **Pattern batch** : `src/lib/estimates/batch.ts` — operations bulk atomiques
- **Calculs devis** : `src/lib/estimate-calculations.ts` — `computeEstimateTotals()`

---

## TKF-007 — Route POST /api/takeoff/jobs + upload Storage bucket + validation

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux uploader un fichier CSV ou Excel et creer un job takeoff,
> afin de lancer l'extraction automatique des donnees du document.

### Criteres d'acceptation

- [ ] Route `POST /api/takeoff/jobs` accepte `FormData`:
  - `file` (`csv`,`xlsx`,`xls`, max 10 Mo)
  - `estimate_version_id` (uuid)
  - `level` (`A`)
- [ ] Validation serveur obligatoire (MIME, extension, taille, fichier non vide)
- [ ] Verification metier:
  - feature flag `TAKEOFF_MODULE_ENABLED` actif pour le tenant
  - `estimate_version_id` existe, appartient au tenant, et est `draft`
- [ ] Upload Storage `takeoff-files/{tenant_id}/{job_id}/{filename}` reussi
- [ ] Job cree avec status `pending`, `prompt_version` et metadata source
- [ ] Support `Idempotency-Key`:
  - meme cle + meme payload => meme job retourne
  - pas de creation de doublons
- [ ] Reponse `201` normalisee contient `id`, `status`, `level`, `source_file_name`,
      `estimate_version_id`, `created_at`
- [ ] Erreurs normalisees: `400`, `403`, `404`, `409`, `413`, `422`
- [ ] Endpoint documente dans OpenAPI (passe `validate-openapi`)
- [ ] Audit event `takeoff.job.created` insere avec `job_id`, `tenant_id`, `user_id`

### Notes techniques

- Fichiers a creer :
  - `src/app/api/takeoff/jobs/route.ts`
  - `src/lib/takeoff/server.ts` (fonctions serveur takeoff)
- Reutiliser :
  - `src/lib/file-validation.ts` — `validateFileForUpload()` a etendre pour CSV/XLSX
  - `src/lib/estimates/server.ts` — `getAuthenticatedContext()`, `assertDraftStatus()`
  - `src/lib/estimates/errors.ts` — `badRequest()`, `forbidden()`, `toErrorResponse()`
  - `src/lib/takeoff/feature-flags.ts` — `assertTakeoffEnabled()`
- Dependances : TKF-001, TKF-003, TKF-005, TKF-006

---

## TKF-008 — Traitement job Niveau A (normalisation Gemini -> Zod -> DB)

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux que le systeme analyse automatiquement mon fichier
> CSV/Excel via Gemini et en extraie des lignes de devis structurees, afin d'eviter
> la saisie manuelle de centaines de lignes.

### Criteres d'acceptation

- [ ] `processLevelA(jobId)` implemente un pipeline transactionnel:
  1. lock job + passage `pending -> processing`
  2. lecture fichier Storage
  3. parsing CSV/XLS/XLSX (multi-feuilles)
  4. appel `callGeminiStructured()` (prompt A + schema)
  5. validation Zod stricte
  6. upsert `takeoff_results` + `takeoff_items`
  7. passage `processing -> completed|failed`
- [ ] Idempotence:
  - relancer un job ne duplique pas les items
  - les anciennes lignes du meme `job_id` sont remplacees de facon atomique
- [ ] Normalisation:
  - detection entetes
  - mapping unites vers referentiel commun (`m`,`ml`,`m2`,`m3`,`u`,`kg`, ...)
  - warnings stockes dans `takeoff_results.warnings`
- [ ] Echec:
  - status `failed`, `error_message` renseigne
  - `raw_response` conserve en cas d'erreur schema
- [ ] Metriques persistes: `token_count`, `cost_cents`, `duration_ms`, `started_at`, `completed_at`
- [ ] Tests couvrent: succes, fichier invalide, erreur Gemini retryable/non-retryable,
      et rerun idempotent

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/processor.ts`
- Reutiliser :
  - `src/lib/takeoff/gemini-client.ts` — `callGeminiStructured()`
  - `src/lib/takeoff/schemas.ts` — `TakeoffExchangeSchema`
  - `src/lib/takeoff/prompts.ts` — prompt Niveau A
- Dependances : TKF-001, TKF-002, TKF-003, TKF-004, TKF-006, TKF-007

---

## TKF-009 — Routes GET job, POST retry, POST cancel

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que chiffreur, je veux consulter le statut de mes jobs takeoff, relancer un job
> echoue, ou annuler un job en cours, afin de garder le controle sur le processus d'extraction.

### Criteres d'acceptation

- [ ] `GET /api/takeoff/jobs/[jobId]` retourne:
  - job + status + timestamps + metrics
  - `result` + `items` pagines (ou limites explicites)
  - payload stable documente OpenAPI
- [ ] `POST /api/takeoff/jobs/[jobId]/retry`:
  - autorise uniquement sur `failed`
  - limite retry (max 3) + backoff
  - remet `pending` et incremente `retry_count`
- [ ] `POST /api/takeoff/jobs/[jobId]/cancel`:
  - autorise sur `pending|processing`
  - passage atomique vers `canceled`
  - ignore si deja terminal (409)
- [ ] `GET /api/takeoff/jobs?estimate_version_id=...` filtre par tenant + version
- [ ] Verification tenant scope sur toutes les routes (RLS + garde applicative)
- [ ] Erreurs normalisees (`404`,`409`,`422`) et audit events `retried`/`canceled`
- [ ] Tous endpoints documentes OpenAPI (passe `validate-openapi`)

### Notes techniques

- Fichiers a creer :
  - `src/app/api/takeoff/jobs/[jobId]/route.ts`
  - `src/app/api/takeoff/jobs/[jobId]/retry/route.ts`
  - `src/app/api/takeoff/jobs/[jobId]/cancel/route.ts`
- Reutiliser :
  - `src/lib/takeoff/server.ts` — fonctions serveur takeoff
  - `src/lib/estimates/errors.ts` — `notFound()`, `conflict()`, `toErrorResponse()`
- Dependances : TKF-007, TKF-008

---

## TKF-010 — UI Upload drag&drop + choix niveau + lancement

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que chiffreur, je veux une interface intuitive pour glisser-deposer un fichier
> et lancer un job takeoff, afin de demarrer une extraction en quelques secondes.

### Criteres d'acceptation

- [ ] Page `/dashboard/estimates/[versionId]/takeoff/new` livre:
  - dropzone + file picker
  - recap fichier (`name`, `size`, `type`)
  - niveau `A` actif, `B/C` visibles mais desactives
  - CTA "Lancer l'extraction"
- [ ] Validation client + serveur coherente (type, taille 10 Mo max, extension)
- [ ] Progression upload visible + etat bouton (`idle/loading/success/error`)
- [ ] Redirection automatique vers `/takeoff/[jobId]` sur succes
- [ ] Messages d'erreur clairs pour: 400/403/409/413/422
- [ ] Accessibilite minimale:
  - labels explicites
  - navigation clavier
  - message d'erreur annonce
- [ ] Tests UI (integration) couvrent flux nominal + erreurs principales

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/estimates/[versionId]/takeoff/new/page.tsx`
  - `src/components/takeoff/TakeoffUploadForm.tsx`
- Reutiliser :
  - `src/lib/takeoff/client.ts` — wrapper API client (a creer)
  - Patterns UI existants dans `src/components/estimates/`
- Dependances : TKF-005, TKF-007

---

## TKF-011 — UI Job Monitor (polling status temps reel)

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que chiffreur, je veux voir en temps reel l'avancement de mon job takeoff,
> afin de savoir quand les resultats sont prets pour review.

### Criteres d'acceptation

- [ ] Page monitor affiche:
  - status + badge + spinner sur `pending|processing`
  - fichier, niveau, timestamps, duree, erreurs, metrics (tokens/cout si dispo)
- [ ] Polling intelligent:
  - intervalle 2s de base
  - backoff en cas d'erreur reseau/429
  - stop automatique sur statut terminal
- [ ] Actions:
  - `Voir les resultats` si `completed`
  - `Relancer` si `failed` (desactive si retry max atteint)
  - `Annuler` si `pending|processing`
- [ ] Etats d'erreur UX:
  - job introuvable (404)
  - acces refuse (403)
  - conflit action (409)
- [ ] Tests integration valident transitions de statuts et actions utilisateur

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/page.tsx`
  - `src/components/takeoff/TakeoffJobMonitor.tsx`
- Reutiliser :
  - `src/lib/takeoff/client.ts` — `getJob()`, `retryJob()`, `cancelJob()`
- Dependances : TKF-009

---

## TKF-012 — UI Review Table (items editables, filtres anomalies, exclusion)

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux examiner et corriger les lignes extraites par Gemini
> dans une table interactive, afin de valider les donnees avant de les appliquer au devis.

### Criteres d'acceptation

- [ ] Page review affiche un tableau editable:
  - colonnes metier + warnings + statut inclusion/verif
  - edition inline validee (type, bornes, champs obligatoires)
  - exclusion/inclusion avec motif obligatoire si exclusion
- [ ] Filtres/tri/compteurs:
  - `Toutes|Incluses|Exclues`
  - par categorie
  - anomalies uniquement
  - tri designation/quantite/categorie
- [ ] Sauvegarde auto (debounce 500ms) via endpoint batch (`PATCH`) idempotent
- [ ] Actions bulk supportees (inclure/exclure) et retour partiel d'erreur gere
- [ ] Chaque modification cree un audit event (`takeoff.item.modified|excluded`)
- [ ] Bouton apply actif si au moins un item inclus et pas d'erreur bloquante
- [ ] Tests UI + API couvrent edition, filtres, bulk, conflit concurrent

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/review/page.tsx`
  - `src/components/takeoff/TakeoffReviewTable.tsx`
- Reutiliser :
  - Patterns editeur inline de `src/components/estimates/EstimateEditorTable.tsx`
  - `src/lib/takeoff/client.ts` — CRUD items
- Dependances : TKF-008, TKF-009

---

## TKF-013 — Apply Wizard multi-etapes (version draft, section, merge strategy)

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux un assistant multi-etapes pour appliquer les items
> extraits dans mon devis, en choisissant la section cible et la strategie de fusion,
> afin de controler precisement comment les donnees IA s'integrent a mon travail.

### Criteres d'acceptation

- [ ] Wizard 3 etapes livre:
  - choix version/section/strategie (`append`,`replace`,`merge`)
  - resume final complet avant confirmation
- [ ] Verification serveur juste avant apply:
  - version toujours `draft`
  - droits ecriture tenant ok
  - job `completed` et non deja `applied`
- [ ] Apply atomique (transaction):
  - insertion/mise a jour des estimate items
  - recalcul des totaux (`computeEstimateTotals()`)
  - echec => rollback complet
- [ ] Reponse API contient:
  - nombre d'items crees/modifies/ignores
  - ids crees
  - status final job `applied`
- [ ] Audit events obligatoires:
  - `takeoff.apply.started`
  - `takeoff.apply.completed` ou `takeoff.apply.failed`
- [ ] Endpoint `POST /api/takeoff/jobs/[jobId]/apply` documente OpenAPI
- [ ] Tests integration couvrent `append|replace|merge`, conflits et rollback

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/TakeoffApplyWizard.tsx`
  - `src/app/api/takeoff/jobs/[jobId]/apply/route.ts`
- Reutiliser :
  - `src/lib/estimates/server.ts` — `createEstimateItem()`, `bulkUpdateEstimateItems()`,
    `assertDraftStatus()`, `insertAssemblyIntoVersion()`
  - `src/lib/estimates/batch.ts` — pattern bulk operations atomiques
  - `src/lib/estimate-calculations.ts` — `computeEstimateTotals()`
- Dependances : TKF-008, TKF-009, TKF-012, TKF-014, TKF-015
