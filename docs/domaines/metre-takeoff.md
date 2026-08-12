# Métré (takeoff) & plans

> **Source : le code au 2026-07-29, avec les baux et la reprise relus au
> 2026-08-12.** En cas de divergence, le code et les migrations font foi.

Périmètre : `src/lib/takeoff/**`, `src/components/takeoff/**`, `src/app/api/{takeoff,internal/takeoff}/**`, `src/app/dashboard/{takeoff,affaires/[projectId]/{plans,takeoff},estimates/[versionId]/{plans,takeoff},admin/takeoff}/**`, `supabase/functions/process_takeoff_job/`, migrations `*tkf*`, `*plan_sets*`, `*takeoff*`. L'application d'un métré au devis est décrite dans [../metier/cycle-de-vie.md](../metier/cycle-de-vie.md) § « Application d'un métré au devis » ; seuls les compléments propres au module figurent ici (§11).

---

## 1. Activation : le module est fermé par défaut

Le drapeau tenant `TAKEOFF_MODULE_ENABLED` (`src/lib/takeoff/constants.ts:1`) est semé à `enabled = false, value = null` pour les tenants existants (`supabase/migrations/20260224153000_tkf005_takeoff_feature_flag.sql:3-6`) et pour chaque nouveau tenant via le trigger `bootstrap_takeoff_feature_flags` (`…tkf005….sql:16`, `:24-26`). `isFeatureEnabled` exige `enabled === true` et renvoie `false` sur toute erreur ou absence de ligne (`src/lib/feature-flags.ts:270-278`) ; `getFeatureFlagValueForTenant` renvoie `null` si le drapeau n'est pas `enabled`, même quand `value` est renseigné (`src/lib/feature-flags.ts:306-311`). Le refus est un 403 de code `TAKEOFF_MODULE_DISABLED`, message « Le module Takeoff est desactive pour ce tenant. » (`src/lib/takeoff/feature-flags.ts:330-334`).

**Court-circuits serveur.** `isTakeoffEnabled` teste deux variables d'environnement **avant** la base : `TAKEOFF_MODULE_FORCE_ENABLED` (`src/lib/takeoff/feature-flags.ts:150`) puis `TAKEOFF_MODULE_ENABLED_BY_DEFAULT` (`:154`) ; valeurs acceptées `1|true|yes|on` (`:65`). La suite E2E s'appuie sur la seconde (`playwright.config.ts:28`). Ces court-circuits sont serveur uniquement : `useTakeoffEnabled` interroge `/api/feature-flags` (`src/hooks/useTakeoffEnabled.ts:24`, `src/hooks/useFeatureFlag.ts:45`) et renvoie `false` tant que l'état n'est pas `ready` (`src/hooks/useTakeoffEnabled.ts:32`).

| Clé | Défaut code | Semis en base | Lecture |
|---|---|---|---|
| `TAKEOFF_MODULE_ENABLED` | — | `false` / `null` (`…tkf005….sql:4` ; `…tkf023….sql:24`) | `feature-flags.ts:158` |
| `TAKEOFF_C_CHUNK_THRESHOLD_PAGES` | `15` (`constants.ts:23`) | `true` / `'15'` (`…tkf023….sql:8`, `:25`) | `feature-flags.ts:166` |
| `TAKEOFF_C_CHUNK_SIZE_PAGES` | `10` (`constants.ts:24`) | `true` / `'10'` (`…tkf023….sql:9`, `:26`) | `feature-flags.ts:167` |
| `TAKEOFF_C_CHUNK_OVERLAP_PAGES` | `2` (`constants.ts:25`) | `true` / `'2'` (`…tkf023….sql:10`, `:27`) | `feature-flags.ts:168` |
| `TAKEOFF_C_MAX_PDF_PAGES` | `200` (`constants.ts:26`) | `true` / `'200'` (`…tkf023….sql:11`, `:28`) | `feature-flags.ts:169` |
| `TAKEOFF_C_TIMEOUT_MS` | `300 000`, borné `[120 000 ; 900 000]` (`constants.ts:27-29` ; `feature-flags.ts:214-216`) | `true` / `'300000'` (`…tkf022….sql:175`) | `feature-flags.ts:197` |
| `TAKEOFF_C_MAX_TOTAL_TOKENS` | `400 000` (`constants.ts:30`) | `true` / `'400000'` (`…tkf022….sql:176`) | `feature-flags.ts:198` |
| `TAKEOFF_C_MAX_COST_CENTS` | `2 500` (`constants.ts:31`) | `true` / `'2500'` (`…tkf022….sql:177`) | `feature-flags.ts:199` |
| `TAKEOFF_LOW_CONFIDENCE_THRESHOLD` | `0.5` (`guards.ts:7`) | aucun | `feature-flags.ts:241` ; SQL `…20260713132407….sql:235` |
| `TAKEOFF_AI_ESCALATION_ENABLED` | `false` (`constants.ts:32`) | aucun | `feature-flags.ts:258` |
| `TAKEOFF_AI_ESCALATION_MIN_CONFIDENCE` | `0.75` (`constants.ts:33`) | aucun | `feature-flags.ts:259` |
| `TAKEOFF_AI_ESCALATION_MAX_COST_CENTS` | `500` (`constants.ts:34`) | aucun | `feature-flags.ts:264` |
| `TAKEOFF_GEMINI_BATCH_MODE` | `false` (`constants.ts:35`) | aucun | `feature-flags.ts:308` |

Absence des quatre derniers semis prouvée par `grep -rn "TAKEOFF_LOW_CONFIDENCE_THRESHOLD\|TAKEOFF_AI_ESCALATION\|TAKEOFF_GEMINI_BATCH_MODE" supabase/` → une seule occurrence, la lecture SQL en `supabase/migrations/20260713132407_harden_takeoff_apply_and_storage.sql:235`.

Variables d'environnement de repli : `TAKEOFF_LEVEL_C_TIMEOUT_MS` (`feature-flags.ts:211`), `TAKEOFF_LEVEL_C_MAX_TOTAL_TOKENS` (`:220`), `TAKEOFF_LEVEL_C_MAX_COST_CENTS` (`:225`), `TAKEOFF_AI_ESCALATION_*` (`:271-279`), `TAKEOFF_GEMINI_BATCH_MODE` (`:313`), `TAKEOFF_GEMINI_TIMEOUT_MS` plafonné à `180 000` ms (`processor.ts:733`, `:95`). Secrets serveur : `GEMINI_API_KEY`, `TAKEOFF_WORKER_SECRET`, `TAKEOFF_WORKER_URL` (`.env.example:7-9`).

**Piège.** `…tkf023….sql:15-33` (2026-02-26) redéfinit `bootstrap_takeoff_feature_flags()` avec 5 drapeaux et écrase la version à 8 drapeaux de `…tkf022….sql:181-202` (2026-02-25) : les nouveaux tenants n'ont pas de ligne pour `TAKEOFF_C_TIMEOUT_MS`, `TAKEOFF_C_MAX_TOTAL_TOKENS`, `TAKEOFF_C_MAX_COST_CENTS`, et les défauts de `constants.ts:27-31` s'appliquent.

---

## 2. Niveaux A / B / C

`TAKEOFF_LEVELS = ["A","B","C"]` (`types.ts:22`), enum SQL `takeoff_job_level` (`supabase/migrations/20260224123000_tkf001_takeoff_schema.sql:5`).

| Niveau | Libellé métier | Entrées | Modèle | Effort | Prompt |
|---|---|---|---|---|---|
| A | « Rapide » (`document-classifier.ts:45`) | `csv`, `xlsx`, `xls` (`server.ts:167-173`) | `gemini-3-flash-preview` (`prompts.ts:28`) | `low` (`:29`) | `takeoff-a-v1` (`:9`) |
| B | « Standard » (`:46`) | `pdf` seul (`server.ts:174-175`) | `gemini-3.1-pro-preview` (`prompts.ts:32`) | `medium` (`:33`) | `takeoff-b-v1` (`:10`) |
| C | « Détaillé » (`:47`) | `pdf` seul (`server.ts:174-175`) | `gemini-3.1-pro-preview` (`prompts.ts:36`) | `high` (`:37`) | `takeoff-c-v1` (`:11`) |

Le niveau B exige au moins un tableau exploitable (`prompts.ts:128-130` ; schéma `schemas.ts:113-119`) ; le niveau C exige `confidence` global plus `confidence`, `source_page` et `evidence` par item (`prompts.ts:144-149`). Le schéma d'échange est `.strict()` (`schemas.ts:99-104`) : `quantity > 0` (`:18-19`), `confidence ∈ [0,1]` (`:35-38`), `designation ≤ 500` caractères (`:75`), `evidence ≤ 2000` (`:81`). Un lancement depuis un jeu de plans n'accepte que `B` ou `C` (`src/app/dashboard/affaires/_actions/takeoff.ts:16`, `:27`), `B` par défaut (`server.ts:176`, `:8272`).

**Escalade.** Quand `TAKEOFF_AI_ESCALATION_ENABLED` vaut vrai, le modèle primaire devient `gemini-3.1-flash-lite-preview` en A et `gemini-3-flash-preview` en B, C inchangé (`prompts.ts:41-54` ; sélection `processor.ts:3808-3810`) ; la matrice de repli est `A → gemini-3-flash-preview`, `B → gemini-3.1-pro-preview`, `C → null` (`prompts.ts:56-71`). L'escalade de niveau B se déclenche si la confiance passe sous `minConfidence`, si le nombre de tableaux est nul, si aucun item n'est retenu, ou si un warning de sévérité `error` existe (`processor.ts:3106-3128`), sous plafond `TAKEOFF_AI_ESCALATION_MAX_COST_CENTS` (`processor.ts:2990-3085`).

**Coût.** Tarifs internes en USD par million de jetons (entrée/sortie) : `gemini-3.1-pro-preview` `2/12`, ou `4/18` au-delà de 200 000 jetons d'entrée ; `gemini-3-flash-preview` `0,5/3` ; `gemini-3.1-flash-lite-preview` `0,25/1,5` ; `gemini-3-pro-preview` `2/12` (`gemini-client.ts:931-942`). Tout autre modèle produit un coût de `0` (`:944`).

---

## 3. Pipeline de traitement

**Chaîne d'appel.** Création du job puis `triggerTakeoffJobProcessing` (`src/app/api/takeoff/jobs/route.ts:40` ; `_actions/takeoff.ts:66`) → appel de l'edge function `…/functions/v1/process_takeoff_job` avec `Authorization: Bearer <service role>` et `apikey`, délai `1 500` ms (`edge-trigger.ts:17`, `:35`, `:65-77`) → l'edge function vérifie que les deux en-têtes valent la clé service-role (`supabase/functions/process_takeoff_job/security.ts:7-10`) puis relaie vers `TAKEOFF_WORKER_URL` avec seulement `x-takeoff-worker-secret` et `x-correlation-id` (`…/index.ts:254-263`), délai relais `240 000` ms (`:57`), auto-invocation `7 500` ms (`:58`) ; `TAKEOFF_WORKER_URL`/`TAKEOFF_WORKER_SECRET` proviennent de l'environnement ou du RPC `get_takeoff_secret` (`:122-163`) → `POST /api/internal/takeoff/process-job` compare `x-takeoff-worker-secret` à `TAKEOFF_WORKER_SECRET` (`route.ts:18`, `:31-35`, repli littéral `"test-worker-secret"` si `NODE_ENV === "test"` `:23-24`) et appelle `processTakeoffJobAttempt` (`:83`). Le worker charge localement le client service-role via la factory canonique `src/lib/supabase/service-role.ts`; aucune clé service-role n'est transportée par le relais HTTP. La route répond `202` en cas de réenfilement ou d'`in_progress`, sinon `200` (`:89-90`) → réenfilement par auto-invocation de l'edge function après `next_run_in_seconds` (`index.ts:373-390`).

Le déclenchement de requête n'est plus la seule chance d'exécution. Les tables
métier restent les files de référence et
`GET /api/internal/workflows/recover`, protégé par `CRON_SECRET`, liste les jobs
`pending`, les retries `failed` échus et les réconciliations batch dues, puis
relance le même relais (`src/lib/workflows/durable-recovery.ts`,
`supabase/migrations/20260811231238_durable_workflow_recovery.sql`).
`vercel.json` demande une exécution `*/5 * * * *` ; cette cadence requiert un
plan Vercel Pro ou Enterprise et **aucun déploiement effectif n'est attesté dans
le checkout**.

Aucune configuration de segment Next n'existe sur cette surface : `grep -rn "maxDuration\|export const runtime\|export const dynamic\|preferredRegion" src/app/api/takeoff src/app/api/internal/takeoff` renvoie 0 ligne.

**Sync vs batch.** `processing_strategy ∈ {sync, batch}` (`types.ts:35` ; enum SQL `…est421….sql:3`). Le drapeau `TAKEOFF_GEMINI_BATCH_MODE` n'est consulté que pour le niveau A (`feature-flags.ts:302-306`) et la stratégie est ramenée à `sync` pour tout autre niveau (`provider-batch.ts:73-78`). En `sync`, appel `POST …/models/{model}:generateContent` (`gemini-client.ts:538`) sur `https://generativelanguage.googleapis.com/v1beta` (`:13`), délai par défaut `60 000` ms (`:8`), 3 tentatives et repli exponentiel de base `250` ms (`:9-10`, `:251-253`). En `batch`, soumission `…:batchGenerateContent` (`:617`), le processeur renvoie `submitted_to_provider` et planifie la réconciliation (`processor.ts:4052-4110`) ; les états bruts sont convertis par `GEMINI_BATCH_STATE_MAP` (`provider-batch.ts:49-58`) et persistés par le RPC `persist_takeoff_provider_batch_snapshot` (`provider-batch.ts:189-206` ; `supabase/migrations/20260309121500_est421_takeoff_provider_batch_snapshot_rpc.sql:1-19`). La table d'historique `takeoff_job_provider_events` n'a que des politiques `select` et `insert` (`…est421_takeoff_provider_batch_persistence.sql:83-113`).

**Baux et fencing fournisseur.** Un traitement synchrone prend un bail UUID de
**30 minutes** ; une réconciliation batch prend un bail de **5 minutes**. Les
appels Gemini (génération, soumission batch et polling) renouvellent le bail
avant et après l'effet. Une perte de bail après l'appel prime sur son résultat :
un worker obsolète ne peut donc pas persister un succès ou un échec après qu'un
autre l'a repris (`src/lib/takeoff/job-lifecycle.ts`,
`src/lib/takeoff/processor.ts`, constantes dans
`src/lib/takeoff/constants.ts`). La base exige en outre un tenant actif pour
acquérir ou renouveler ces baux.

**Réconciliation.** Repli `[10, 20, 40, 60]` s, `24` tentatives et RPC
`acquire_takeoff_batch_reconcile_lease`. Le dépassement du compteur sur un lot
non terminal clôt le job en échec avec `AI_TIMEOUT`. Le snapshot fournisseur
est persisté par une RPC protégée par le token de bail, pas par un `UPDATE` libre.

**Découpage PDF (niveau C).** `buildPdfChunks` renvoie un chunk unique tant que `pageCount ≤ thresholdPages` (`chunking.ts:108-116`) ; au-delà, le pas vaut `chunkSizePages − overlapPages` (`:118`), l'`overlap` étant ramené à `min(overlap, chunkSize − 1)` (`feature-flags.ts:126`). La fusion déduplique sur `designation::unit::source_page` (`chunking.ts:73-78`), garde l'item le plus confiant, concatène les evidences par `" | "` (`:196-212`) et moyenne la confiance globale (`:216-222`). Au-delà de `maxPdfPages` : erreur 413 `TAKEOFF_FILE_TOO_LARGE` (`processor.ts:2701-2714`). Les budgets jetons et coût sont évalués après chaque chunk et lèvent `TAKEOFF_LEVEL_C_BUDGET_EXCEEDED` (`processor.ts:2802-2860`) ; chaque chunk écrit une ligne `takeoff_run_metrics` avec `timed_out` et `budget_exceeded` (`processor.ts:2817-2818` ; table `…tkf022….sql:3-33`).

Un PDF est jugé inexploitable si, en C, aucun item n'est produit, ou si, en B, tableaux ou items sont vides → `TAKEOFF_PDF_NOT_INTERPRETABLE` (`processor.ts:3151-3170` ; messages `pdf-validation.ts:164-170`).

**Reprises automatiques.** `TAKEOFF_RETRY_MAX = 3` (`async-worker.ts:20` ; `types.ts:879`), repli `[5, 15, 45]` s (`async-worker.ts:21`). Quatre codes seulement sont relançables par défaut : `AI_RATE_LIMIT`, `AI_TIMEOUT`, `AI_PROVIDER`, `TAKEOFF_LEVEL_C_TIMEOUT` (`errors.ts:412-419`).

Un job synchrone resté `processing` après expiration du bail est terminalisé en
`failed` avec `TAKEOFF_WORKER_OUTCOME_UNKNOWN` : son effet fournisseur pourrait
avoir eu lieu, donc le système ne le rejoue pas aveuglément. À l'inverse, un
batch garde son identifiant fournisseur et revient dans la file de
réconciliation. Le nettoyage des jobs synchrones stales s'exécute aussi pour
un tenant suspendu, mais la liste de dispatch et tout renouvellement de bail
exigent un tenant actif. Un appel déjà en vol ne peut pas être préempté ; son
renouvellement post-appel échoue et empêche la persistance par le worker devenu
obsolète.

---

## 4. États

### 4.1 Statut technique du job

`pending`, `processing`, `completed`, `failed`, `canceled`, `applied` (`types.ts:25-33` ; enum SQL `…tkf001_takeoff_schema.sql:13-20`). Terminaux côté application : `completed`, `failed`, `canceled`, `applied` (`types.ts:914-919`) ; côté worker : `completed`, `canceled`, `applied` (`async-worker.ts:22`). Transitions autorisées aux appelants `authenticated` : `pending → processing|canceled`, `processing → completed|failed|canceled`, `failed → pending|processing`, `canceled → pending`, `completed → applied` ; toute autre lève `TAKEOFF_JOB_STATUS_TRANSITION_DENIED` (`…20260713132407….sql:141-150`).

### 4.2 État du lot fournisseur

| Valeur | Déclaration | État Gemini source |
|---|---|---|
| `submitted` | `types.ts:40` / `…est421….sql:12` | `JOB_STATE_SUBMITTED` (`provider-batch.ts:50`) |
| `pending` | `types.ts:41` | `JOB_STATE_PENDING` (`:51`) |
| `running` | `types.ts:42` | `JOB_STATE_RUNNING` (`:52`) |
| `succeeded` | `types.ts:43` | `JOB_STATE_SUCCEEDED` (`:53`) |
| `failed` | `types.ts:44` | `JOB_STATE_FAILED` (`:54`) |
| `cancelled` | `types.ts:45` | `JOB_STATE_CANCELLED` / `JOB_STATE_CANCELED` (`:55-56`) |
| `expired` | `types.ts:46` | `JOB_STATE_EXPIRED` (`:57`) |
| `unknown` | `types.ts:47` | repli (`:112`) |

Terminaux : `succeeded`, `failed`, `cancelled`, `expired` (`provider-batch.ts:115-124`). Le statut de job s'écrit `canceled` (`…tkf001….sql:18`) et l'état de lot `cancelled` (`…est421….sql:17`).

### 4.3 État opérateur

| Valeur | Libellé | Dérivation |
|---|---|---|
| `none` | « Aucune action requise » (`operator-state.ts:30`) | job non-`batch` ou sans `provider_batch_id` (`:79-81`) |
| `submitted_to_provider` | « Soumis au provider » (`:31`) | `processing` + état `submitted` (`:119-121`) |
| `awaiting_provider_result` | « En attente du resultat provider » (`:32`) | cas résiduel `processing` (`:141`) |
| `provider_failed` | « Echec provider » (`:33`) | `failed` + état fournisseur en échec (`:98-104`) |
| `orphan_to_reconcile` | « Reprise reconcile requise » (`:34`) | `processing` + état terminal (`:83-89`) ; `failed` + `succeeded` (`:91-96`) ; bail expiré (`:124-127`) ; échéance dépassée de 90 s (`:129-135`) ; `errorCode === "AI_TIMEOUT"` (`:137-139`) |

Capacités dérivées `canReconcile`, `canCancel`, `canResubmit` (`operator-state.ts:173-191`). Les mutations opérateur sont réservées aux rôles `admin` et `engineer` (`operator-state.ts:9` ; `server.ts:191-196` ; politiques restrictives `…20260713140006….sql:53-69`).

### 4.4 Statut visible dans l'interface

| Valeur | Libellé | Règle |
|---|---|---|
| `queued` | « En file » | `pending` (`visible-status.ts:103-105`) |
| `provider_pending` | « En attente provider » | `processing` + `batch` + état ∈ {`submitted`,`pending`,`running`} (`:50-54`, `:107-117`) |
| `processing` | « En traitement » | `processing` sinon, et repli général (`:119-123`, `:151-154`) |
| `review_required` | « Revue requise » | `completed`/`applied` avec `compareSummaryUnavailable` ou `exceptionCount > 0` (`:125-136`) |
| `completed` | « Analyse terminée » | `completed`/`applied` sans exception (`:138-141`) |
| `action_required` | « Échec à corriger » | `failed` ou `canceled` (`:144-149`) |

Sous-ensemble « en vol » : `queued`, `processing`, `provider_pending` (`visible-status.ts:16-20`). Une nouvelle analyse n'est proposée que lorsque le statut visible est nul (`:94-98`). Dix codes d'erreur ont un message métier dédié (`:60-80`), avec un repli générique (`:166`). **Piège** : `continuity.ts:3-5` classe sur les statuts visibles alors que `version-links.ts:48-50` classe sur les statuts bruts, avec les littéraux homonymes `processing`, `completed`, `failed`.

### 4.5 Actions opérateur

| Action | Statuts admis | Contraintes |
|---|---|---|
| `retry` | `failed` (`server.ts:6861-6867`) | `retry_count < 3` (`:6869-6881`) et délai de repli écoulé depuis `completed_at` (`:6883-6900`) |
| `cancel` | `pending`, `processing` (`:6980-6986`) | écriture conditionnée par `.in("status", ["pending","processing"])` (`:7000`) |
| `resubmit` | `failed`, `canceled` (`:6697-6703`) | refus si le lot est `succeeded` ou encore vivant (`:6707-6716`) |
| `reconcile` | stratégie `batch` avec `provider_batch_id` (`:6565-6577`) | exige `operatorState.canReconcile` (`:6579`) |

Sondage client : intervalle de base `2 000` ms, plafond `30 000` ms, repli exponentiel sur erreurs consécutives (`use-takeoff-job-polling.ts:12-13`, `:25-26`).

---

## 5. Jeux de plans et fichiers

Tables `plan_sets` et `plan_files` (`supabase/migrations/20260224203000_tkf017_takeoff_plans.sql:3-13`, `:15-29`), `plan_files.file_path` unique (`:109-110`). `plan_sets.project_id` devient obligatoire et `estimate_version_id` facultatif (`…v3_004_plan_sets_backfill_project_id.sql:79-80`, `:95-96`) ; `takeoff_jobs.plan_set_id` référence le jeu source (`…v3_014_takeoff_jobs_plan_set_id.sql:1-10`).

| Limite | Valeur | Code | Contrôle SQL |
|---|---|---|---|
| Taille d'un fichier de plan | `52 428 800` o, « 50 Mo » | `plans.ts:24-25` | `PLAN_FILE_SIZE_BUDGET_EXCEEDED` (`…20260713150322….sql:22-29`) |
| Fichiers par jeu | `20` | `plans.ts:26` | `PLAN_SET_FILE_COUNT_BUDGET_EXCEEDED` (`…:52-56`) |
| Taille cumulée par jeu | `104 857 600` o | `plans.ts:27` | `PLAN_SET_TOTAL_SIZE_BUDGET_EXCEEDED` (`…:58-62`) |
| Fichier source takeoff (dépôt direct) | `10 485 760` o, « 10 Mo » | `src/lib/file-validation.ts:1-2` via `server.ts:1448-1449` | `file_size_limit` du bucket (`…tkf007_takeoff_storage_bucket.sql:8`) |

Buckets privés : `takeoff-files`, MIME tabulaires uniquement (`…tkf007….sql:3-14`) ; `plan-files`, `52 428 800` o, `application/pdf` seul (`…tkf017….sql:341-349`). Chemin canonique d'un fichier de plan `tenant_id/plan_set_id/plan_file_id/file_name`, imposé par `enforce_plan_file_storage_identity` (`PLAN_FILE_STORAGE_PATH_INVALID`, `…20260713140006….sql:13-23`), identité immuable en mise à jour (`:29-35`). URL signées : dépôt `7 200` s, téléchargement `600` s (`plans.ts:28-29`), méthode `PUT` (`:1300`). Le MIME est toléré si l'extension est `.pdf` pour sept types non fiables dont `application/octet-stream` (`pdf-validation.ts:27-35`, `:55-58`).

Jeu par défaut : nom `"Plans import"` (`default-import-plan-set.ts:1`), marqueurs `{source: "import-flow"|"affaire-intake", default_import_plan_set: true}` (`:3-11`). La synchronisation depuis l'intake affaire ne retient que les documents `uploaded` + `classified` + `document_kind = "plans"` en PDF (`src/lib/affaires/intake-plan-sync.ts:91-105`).

---

## 6. Revue

Deux couches de modes coexistent.

- **Mode d'interface global** : `simplified` (défaut) ou `expert`, persisté sur `profiles.ui_mode` et en `localStorage` sous `timax-ui-mode` (`src/lib/ui-mode.ts:1-5` ; `src/hooks/useUiMode.ts:14-21`, `:63-88`).
- **Mode de revue métier** : `assisted` | `production` | `validation` (`review/TakeoffReviewModeSwitch.tsx:9`, libellés « Assiste », « Production », « Validation » `:20-36`), porté par le paramètre d'URL `reviewMode` (`TakeoffReviewPage.tsx:248`). Défaut : `validation` si `from=approval` ou en contexte affaire, sinon `assisted` en mode simplifié et `production` en mode expert (`:252-256`) ; le paramètre est retiré de l'URL quand il vaut le défaut (`:271-282`).

`src/components/takeoff/TakeoffReviewSimplified.tsx` n'a aucun importateur hors test : `grep -rn "TakeoffReviewSimplified" src/` hors `.test.` ne renvoie que ses propres déclarations. Le panneau assisté vivant est `review/AssistedReviewPanel.tsx`, qui ajoute un troisième état « marqué pour revue » (`:98-104`).

Onglets du mode production : `tables`, `items`, `compare`, `dpgf` (`TakeoffReviewExpert.tsx:35`) ; en mode assisté l'onglet est forcé sur `items` (`TakeoffReviewPage.tsx:313`). Anomalies : `low_confidence` (`< 0,5`), `missing_evidence`, `zero_quantity` (`≤ 0`), `empty_designation` (`TakeoffReviewTable.tsx:31-35`, `:75-90`) ; bloquantes = désignation vide ou quantité ≤ 0 (`:92-94`). Filtres du mode validation : `priority` (défaut), `all`, `low_confidence`, `missing_evidence`, `anomalies`, `unverified`, `open_hypotheses`, `missing_source_context` (`ValidationReviewPanel.tsx:33-41`, `:222`) ; une hypothèse ouverte est une evidence présente, non vérifiée, de confiance nulle ou `< 0,8` (`:119-125`). Lots : `REVIEW_ITEMS_PAGE_SIZE = 200`, `DPGF_COMPARE_PAGE_SIZE = 200`, `AUTO_SAVE_DEBOUNCE_MS = 500`, `TAKEOFF_ITEM_PATCH_BATCH_MAX = 100` (`TakeoffReviewPage.tsx:135-141`).

L'onglet « Exceptions » (`TakeoffExceptionsTab.tsx`) affiche des alertes de risque, pas des écarts DPGF : il consomme `/risk-radar` (`:121-139`) avec un filtre de statut par défaut `to_process` (`:68-74`).

---

## 7. Rapprochement DPGF

Statuts de ligne : `reliable_match`, `to_confirm`, `significant_gap`, `unlinked`, `forced_manual` (`types.ts:444-449`) ; les quatre autres que `reliable_match` comptent comme exceptions (`dpgf-compare.ts:82-87`, `:670`).

- **Score d'appariement** (`dpgf-compare.ts:214-247`) : similarité textuelle, `+0,05` si unités normalisées égales (`:231-237`), `+0,03` si une chaîne contient l'autre (`:239-243`), plafond `0,9999` (`:246`), `null` si unités incompatibles (`:218-220`).
- **Score de confiance** (`:411-439`) : `0,45 × appariement + 0,40 × confiance takeoff`, bonus preuves `min(0,16 ; nbFaits × 0,04)`, pénalités `0,14` (hypothèse), `0,18` (conflit d'unité), `0,04` (décision reprise), borné `[0,05 ; 0,99]`.
- **Dérivation du statut** (`:441-476`), dans l'ordre : décision appliquée ou lien manuel → `forced_manual` ; aucun item lié → `unlinked` ; conflit d'unité ou `|Δ%| > 20` → `significant_gap` ; plus d'un item lié, ou `Δ% ≥ 5`, ou confiance `< 0,72`, ou appariement `< max(seuil ; 0,9)` → `to_confirm` ; sinon `reliable_match`. Constantes `RELIABLE_MATCH_MIN_SCORE = 0.9`, `TO_CONFIRM_MIN_CONFIDENCE = 0.72` (`:80-81`) ; seuil global par défaut `0,8`, borné `[0,5 ; 0,99]` (`diff.ts:12-14`).
- **Appariement automatique global**, non glouton : toutes les paires au-dessus du seuil sont triées (score, confiance, identifiants) puis assignées une à une (`:531-586`) ; les liens manuels sont retirés du vivier au préalable (`:803-826`).

Liens manuels : `PATCH /api/takeoff/jobs/{jobId}/dpgf-link`, maximum `50` items par ligne, tableau vide = suppression de tous les liens (`server.ts:957-966`). Le RPC `save_takeoff_dpgf_manual_links` remplace l'ensemble de façon atomique (`…20260306153000….sql:35-135`) ; la contrainte « un item par ligne » est levée (`:5-6`) au profit de l'unicité de paire (`:24-26`).

Décisions : `keep_dpgf`, `keep_takeoff`, `manual_fix`, `out_of_scope` (`types.ts:451-455` ; contrainte SQL `…20260306153000….sql:153-154`), `reason` limitée à `2000` caractères (`server.ts:968-975`), action d'audit `takeoff.dpgf.review_decision` (`server.ts:6227`). Elles sont recopiées sur la version dupliquée avec `carried_over_from_version_id` (`…20260306153000….sql:766-805`) et rejouées par `review_reference` (`dpgf-compare.ts:196-212`, `:798-800`).

Blocage de l'application : `to_confirm > 0` ou `significant_gaps > 0` ou `lines_without_proof > 0` ou `forced_manual > 0` ou (`total_lines > 0` et `unused_takeoff_items > 0`) (`dpgf-compare.ts:27-41`).

---

## 8. Preuves et confiance

Table `estimate_line_evidences` : `evidence_type ∈ {dpgf, takeoff, plan_zone, formula, price_source, comment}`, `evidence_kind ∈ {fact, hypothesis, inference}`, `confidence_score ∈ [0,1]` (`supabase/migrations/20260306213000_est391_line_evidence_graph.sql:14-23`). Statut applicatif `active` | `invalidated` | `replaced` (`types.ts:490`) ; raison d'invalidation `"snapshot_replaced"` (`evidence.ts:100`). `buildProofs` émet toujours une preuve `dpgf`/`fact`, une preuve `takeoff`/`fact` par item lié, une preuve `plan_zone` si page ou fichier connu, une preuve `formula`/`inference` au-delà d'un item agrégé, et une preuve `comment` par décision appliquée (`dpgf-compare.ts:320-409`).

| Seuil | Valeur | Emploi |
|---|---|---|
| Blocage d'application | `0,5` (défaut) | `guards.ts:7`, `:66-73` |
| Plafond « moyen », avertissement seul | `0,8` | `guards.ts:8`, `:74` |
| Libellés de liste | `≥ 0,8` « Élevée », `≥ 0,5` « Moyenne », sinon « Faible » | `takeoff-job-list-shared.tsx:266-271` |
| Couverture faible | `< 50 %` | `takeoff-job-list-shared.tsx:282-284` |
| Anomalie de revue | `< 0,5` | `TakeoffReviewTable.tsx:75-90` |
| Hypothèse ouverte | `< 0,8` | `ValidationReviewPanel.tsx:119-125` |

Un item de confiance `null` est traité comme faible et bloque (`guards.ts:66-67`).

---

## 9. Règles de mapping

Table `takeoff_mapping_rules` (`supabase/migrations/20260224190000_tkf029_takeoff_mapping_rules.sql:3-16`) : `match_type ∈ {exact, contains, regex}` (`:38` ; `schemas.ts:192-196`), `action ∈ {rename, set_price, set_category, apply_assembly, skip}` (`:44` ; `schemas.ts:198-204`), `priority` par défaut `100` et `≥ 0` (`:13`, `:50`), plafond applicatif `100 000` (`schemas.ts:185-188`).

Les règles actives sont triées par `priority` croissante puis `created_at` puis `id` (`mapping-engine.ts:66-77`) et **la première qui correspond gagne** (`:109-158`). Normalisation : trim, espaces compactés, minuscules `fr-FR` (`:42-51`) ; les expressions régulières sont compilées avec le seul drapeau `i` et testées sur la désignation non minusculée (`:89`, `:131-139`). Une surcharge manuelle prime sur la règle (`:187-220`), l'action supplémentaire `none` n'existant que côté surcharge (`schemas.ts:462-469`) ; `skip` et `apply_assembly` excluent l'item (`mapping-engine.ts:238-288`). L'administration `/api/takeoff/mapping-rules` s'appuie sur `assertTakeoffMappingRulesAdminRole` (`server.ts:8707-8708`, `:8735-8736`) et **ne passe pas** par `assertTakeoffEnabled` ; RLS d'écriture réservée aux `admin` (`…tkf029….sql:93-104`).

---

## 10. Suggestions de prix

Table `takeoff_price_suggestions` : `status ∈ {pending, applied, kept_current, rejected}`, `confidence_label ∈ {low, medium, high}`, `low_cents ≤ target_cents ≤ high_cents` (`…est392….sql:17-18`, `:29-30`, `:194`). Quantiles pondérés `P20 / P50 / P80` (`price-suggestions.ts:356-358`), écarteurs de Tukey `1,5 × IQR` désactivés sous quatre valeurs (`:77-94`), confiance `0,45 × volume + 0,35 × diversité + 0,20 × dispersion` (`:102-130`) libellée `high` à partir de `0,75` et `medium` à partir de `0,5` (`:119-124`). Actions de revue : `apply_low`, `apply_target`, `apply_high`, `keep_current`, `reject` (`types.ts:690-695`).

---

## 11. Application au devis — compléments

Le détail (stratégies `append`/`replace`/`merge`, portées `section`/`version`, verrou de brouillon, forçage admin, `partial_apply`) est dans [../metier/cycle-de-vie.md](../metier/cycle-de-vie.md) § 9. Compléments propres au module :

- Le RPC `apply_takeoff_job(p_job_id, p_strategy, p_target_section_id)` exige le statut `completed` du job et `draft` de la version (`…tkf013_takeoff_apply_rpc.sql:68-70`, `:83-85`) et termine en passant le job à `applied` (`:570-576`).
- La garde de confiance est doublée en base : `enforce_takeoff_apply_security` rejoue le calcul, exige un verrou `draft_locks` non expiré et ne s'applique qu'au niveau `C` (`…20260713132407….sql:219-263`). Le forçage admin exige une entrée d'audit `takeoff.apply.override` de moins de `15` minutes couvrant exactement les items bloqués, avec une justification de `10` à `500` caractères, consommée une seule fois via `takeoff_apply_override_consumptions` (`:279-356`).
- Après application, toute mutation d'item du job est refusée : `TAKEOFF_ITEM_APPLIED_JOB_IMMUTABLE` (`:51-52`).
- `replace` sans section cible supprime **toutes** les lignes de la version (`…tkf013….sql:169-173`). Le fichier `supabase/migrations/20260718014058_protect_takeoff_replace_with_recovery.sql` est vide : `wc -c` renvoie `0`.
- L'aperçu d'impact apparie en `merge` par clé exacte `designation` + `unit`, sans score (`apply-impact.ts:106-112`) ; les lignes créées portent `unit_price_ht_cents = 0` et `source_provider = 'takeoff'` (`…tkf013….sql:247`, `:254`). Traçabilité sur `estimate_items` : `source_provider`, `source_job_id`, `source_file_name`, `source_page` (`…tkf014_estimate_items_source_tracking.sql:3-7`).

---

## 12. Radar de risque

Table `estimate_risk_alerts` (`…est393_takeoff_risk_radar.sql:5-48`) : `scope_type ∈ {project, lot, line}` (`:13-14`), `severity ∈ {info, warning, critical}` (`:29-30`), `status ∈ {to_process, assumed, false_positive}` défaut `to_process` (`:31-32`), `risk_score` entre `0` et `100` (`:33-34`), `margin_bucket ∈ {negative, thin, healthy, unknown}` (`:35-36`), six `cause_code` (`:18-28` ; miroir `types.ts:557-563`).

Poids par cause : `missing_proof 40`, `dpgf_takeoff_gap 35`, `atypical_price 25`, `insufficient_margin 35`, `vat_inconsistency 20`, `missing_piece 30` (`risk-radar.ts:18-25`). Sévérité : `≥ 70` critique, `≥ 35` avertissement, sinon information (`:110-114`). Score de périmètre `clamp(scoreMax + max(0, nbCritiques − 1) × 5, 0, 100)` (`:405-407`, `:517-538`). Déclencheur d'écart DPGF `|Δ%| > 20` (`:609-613`) ; seuil de marge par défaut `1000` points de base (`server.ts:4103-4104`).

Cycle de vie : le `GET /risk-radar` recalcule et persiste la projection (`server.ts:4939-4946`) ; les alertes existantes conservent `status`, `review_note`, `reviewed_at`, `reviewed_by` (`:4178-4190`) et celles qui disparaissent sont désactivées `is_active = false` sans suppression (`:4202-4237`) — la table n'a aucune politique `delete` (`…est393….sql:310-397`). Sortir de `to_process` impose une note humaine non vide, imposée en base (`:192-203`) et au schéma (`server.ts:1003-1021`, maximum `2000` caractères).

---

## 13. Métriques et supervision

`/api/takeoff/metrics/stats` agrège `takeoff_jobs`, `takeoff_run_metrics`, `takeoff_results`, `takeoff_items` et `audit_logs` sur `7d`, `30d`, `90d` (`types.ts:1005-1006` ; `stats.ts:30-34`). Cibles pilote codées en dur : coût moyen `≤ 1 000` centimes, durée moyenne `≤ 600 000` ms, taux de correction `≤ 40 %`, satisfaction `≥ 60 %` (`stats.ts:39-42`) ; volume minimal `3` (7 j), `8` (30 j), `20` sinon (`:109-113`) ; verdict `go` | `watch` | `no_go` | `inconclusive` (`:829-867`). L'état de `TAKEOFF_MODULE_ENABLED` est renvoyé comme donnée `killSwitchEnabled`, pas comme blocage (`src/app/api/takeoff/metrics/stats/route.ts:107`, `:201`) ; `/api/takeoff/stats` est un réexport du même gestionnaire (`src/app/api/takeoff/stats/route.ts:1`). Le tableau de bord rafraîchit toutes les `120 000` ms (`TakeoffMetricsDashboard.tsx:86`), avec des seuils d'affichage `≥ 90 / ≥ 70` pour le taux de succès (`:169-175`) et `≥ 0,8 / ≥ 0,6` pour la confiance (`:191-199`).

`/api/takeoff/health` renvoie `{tenant_id, enabled: true}` quand le module est actif, et le 403 `TAKEOFF_MODULE_DISABLED` sinon (`src/app/api/takeoff/health/route.ts:43-51`).

Audit : 16 actions `takeoff.*` (`src/lib/takeoff/audit.ts:13-32`), contrainte `audit_logs_action_check` à jour en `…est423_takeoff_human_correction_audit_actions.sql:9-29` ; l'insertion est restreinte aux actions `takeoff.%` sur `takeoff_jobs`/`takeoff_items` avec `estimate_version_id` renseigné (`…tkf015_takeoff_audit_rls_policy.sql:10-14`).

---

## 14. Routes

| Route API | Verbes | Garde du module |
|---|---|---|
| `/api/takeoff/activity-center` | `GET` (`route.ts:7`) | indirecte (`activity-center.ts:645`) |
| `/api/takeoff/health` | `GET` (`:43`) | directe (`:46`) |
| `/api/takeoff/jobs` | `GET` (`:24`), `POST` (`:40`) | indirecte (`server.ts:8065`) |
| `/api/takeoff/jobs/[jobId]` | `GET` (`:18`) | indirecte |
| `…/[jobId]/apply` | `POST` (`:11`) | indirecte |
| `…/[jobId]/cancel` · `retry` · `resubmit` · `reconcile` | `POST` (`:11` · `:12` · `:12` · `:16`) | indirecte |
| `…/[jobId]/items` | `PATCH` (`:11`) | indirecte |
| `…/[jobId]/compare` · `dpgf-compare` · `risk-radar` | `GET` (`:18` · `:20` · `:18`) | indirecte |
| `…/[jobId]/dpgf-link` · `review-decision` | `PATCH` (`:11` · `:11`) | indirecte |
| `…/[jobId]/lines/[lineId]/evidence` | `GET` (`:20`) | indirecte |
| `…/[jobId]/preview-conversion` | `POST` (`:11`) | indirecte |
| `…/[jobId]/price-suggestions` | `GET` (`:19`), `POST` (`:40`) | indirecte |
| `…/[jobId]/price-suggestions/[suggestionId]` | `PATCH` (`:13`) | indirecte |
| `…/[jobId]/risk-alerts/[alertId]` | `PATCH` (`:13`) | indirecte |
| `/api/takeoff/mapping-rules` | `GET` (`:50`), `POST` (`:61`) | rôle `admin` seul |
| `/api/takeoff/mapping-rules/[ruleId]` | `PATCH` (`:62`), `DELETE` (`:78`) | rôle `admin` seul |
| `/api/takeoff/metrics/stats` · `/api/takeoff/stats` | `GET` (`:104`) · réexport (`:1`) | drapeau renvoyé comme donnée |
| `/api/takeoff/plan-sets` | `GET` (`:21`), `POST` (`:31`) | indirecte (`plans.ts:533`) |
| `/api/takeoff/plan-sets/[setId]` | `DELETE` (`:144`), `GET` (`:157`), `PATCH` (`:170`), `PUT` (`:182`) | directe (`:95`) ; `PATCH` et `PUT` appellent le même `handleUpdate` (`:134`) |
| `/api/takeoff/plan-sets/[setId]/files` | `GET` (`:35`), `POST` (`:52`) | indirecte |
| `/api/takeoff/plan-sets/[setId]/files/[fileId]` | `GET` (`:28`), `DELETE` (`:46`) | indirecte |
| `/api/internal/takeoff/process-job` | `POST` (`:78`) | secret worker (`:31-35`) |

« Indirecte » = `getAuthenticatedTakeoffContext()` appelle `assertTakeoffEnabled` (`server.ts:2736-2738` ; `plans.ts:531-533`).

**Interface.** Parcours canonique, badge « Parcours recommandé » (`route-hierarchy.ts:152`) : `/dashboard/affaires/[projectId]/plans` (`plans/page.tsx:16`), `…/takeoff` (`takeoff/page.tsx:23`), `…/takeoff/[jobId]/review` (`review/page.tsx:14`, paramètre `versionId` obligatoire `:18`). Parcours conservé, badge « Ancien parcours » (`route-hierarchy.ts:182`) : `/dashboard/takeoff`, `/dashboard/estimates/[versionId]/plans`, `…/takeoff`, `…/takeoff/new`, `…/takeoff/[jobId]`, `…/takeoff/[jobId]/review` — tous affichent `TakeoffDeprecationBanner` avec une cible de report calculée par `buildLegacyTargetHref` (`route-hierarchy.ts:56-93`). Administration : `/dashboard/admin/takeoff/mapping-rules` redirige vers `/dashboard` si le module est inactif (`page-content.tsx:38-40`) ; `/dashboard/admin/takeoff/metrics` ne contrôle que le rôle `admin` (`page-content.tsx:34`). Le drapeau se bascule depuis `/dashboard/admin/flags` (`admin/flags/page.tsx:10-11`), écriture réservée aux `admin` (`src/lib/feature-flags.ts:207-209`).

---

## 15. Codes d'erreur

31 valeurs dans `TakeoffErrorCode` (`src/lib/takeoff/errors.ts:7-37`), dont `TAKEOFF_MODULE_DISABLED`, `TAKEOFF_FILE_TOO_LARGE`, `TAKEOFF_FILE_TYPE_INVALID`, `TAKEOFF_PDF_CORRUPTED`, `TAKEOFF_PDF_NOT_INTERPRETABLE`, `TAKEOFF_LEVEL_C_TIMEOUT`, `TAKEOFF_LEVEL_C_INVALID_SCHEMA`, `TAKEOFF_LEVEL_C_BUDGET_EXCEEDED`, `TAKEOFF_APPLY_GUARD_FAILED`. Les secrets sont expurgés des détails : clés `AIza…`, en-têtes `authorization` et `x-goog-api-key`, jetons porteurs (`errors.ts:66-69`, `:80-81`).

---

## 16. Pièges

1. **Le module est fermé par défaut** : sans bascule du drapeau tenant ni variable d'environnement, les pages répondent `notFound()` et les routes gardées `403` (`…tkf005….sql:4` ; `feature-flags.ts:330-334`).
2. **L'application est irréversible et à un coup** : le job passe à `applied` (`…tkf013….sql:570-576`) et ses items deviennent immuables (`…20260713132407….sql:51-52`).
3. **`replace` sans section cible efface toute la version** (`…tkf013….sql:169-173`) ; la migration nommée `…protect_takeoff_replace_with_recovery.sql` est vide (`wc -c` = 0).
4. **Deux vocabulaires de statut** cohabitent, bruts (`types.ts:25-33`) et visibles (`visible-status.ts:7-14`), avec des littéraux homonymes, plus l'orthographe divergente `canceled` / `cancelled`.
5. **Les jobs batch restent `processing`** en attente du fournisseur ; l'état
   `orphan_to_reconcile` et le bail de réconciliation de 5 minutes matérialisent
   la reprise. Pour les jobs sync, une expiration après appel fournisseur mène
   au statut terminal `TAKEOFF_WORKER_OUTCOME_UNKNOWN`, à rapprocher avant tout
   rejeu.
6. **Les budgets du niveau C interrompent le traitement en cours de découpage** (`processor.ts:2802-2860`) ; les chunks déjà consommés sont facturés et tracés dans `takeoff_run_metrics`.
7. **Les règles de mapping échappent au drapeau du module** (`server.ts:8707-8708`).
8. Les pages du tableau de bord répondent `notFound()` quand le module est inactif, les pages d'administration `redirect()`.
9. `TAKEOFF_FLOW_KINDS` déclare `adjacent` (`flow-hierarchy.ts:3`) mais `resolvePlanSetFlowDescriptor` ne renvoie que `legacy` ou `principal` (`:13-35`) ; `adjacent` n'arrive que par la propriété passée en `src/app/dashboard/affaires/[projectId]/takeoff/page.tsx:125`.
10. **La reprise durable n'est qu'une capacité tant qu'elle n'est pas
    exploitée** : `CRON_SECRET`, le plan Vercel compatible et le déploiement de
    la cadence `*/5` ne sont pas vérifiables depuis le dépôt. Aucun appel Gemini
    réel n'a été déclenché pour valider ce lot documentaire.
