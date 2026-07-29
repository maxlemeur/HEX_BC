# Affaires & Intake

> **Source : le code au 2026-07-29.** Chaque affirmation porte une référence `fichier:ligne`. En cas de divergence, le code fait foi et ce document doit être corrigé.

Les règles de calcul et le cycle de vie des versions ne sont pas repris ici : voir `../metier/regles-de-calcul.md` et `../metier/cycle-de-vie.md`.

---

## 1. Vocabulaire et entité racine

Une « affaire » est une ligne de **`public.estimate_projects`** (`supabase/schema.sql:334-344`). Il n'existe aucune table `projects` (vérifié : `grep -rn "create table.*public.projects\b" supabase/` → 0 résultat). Colonnes : `id`, `created_at`, `updated_at`, `user_id → profiles(id) on delete restrict` (`schema.sql:338`), `name not null`, `reference`, `client_name`, `notes`, `is_archived not null default false` (`schema.sql:343`). Le `tenant_id` est ajouté ensuite (`supabase/migrations/013_multitenant_core_s5.sql:220`), avec `default public.current_tenant_id()` (`013:479`) puis `not null` (`013:503`).

RLS principale : « Users can manage estimate projects » — membre du tenant ET (propriétaire OU rôle `admin`) (`013_multitenant_core_s5.sql:1384-1385`). Une politique SELECT distincte ouvre la lecture aux directeurs (`20260306143000_v3_015_director_approval_workflow.sql:250-263`).

Rôles tenant : `admin`, `engineer`, `viewer` (`013_multitenant_core_s5.sql:5`) plus `director` (`20260306130000_v3_010_takeoff_dpgf_links.sql:6`).

**Deux fonctions `SECURITY DEFINER` avec des périmètres différents**, à ne pas confondre :

| Fonction | Rôles acceptés | Référence |
|---|---|---|
| `can_access_affaire_intake_project` | propriétaire ou `admin` | `20260306210000_est371_affaire_intake.sql:123-143`, condition l.140 |
| `can_read_affaire_intake_project` | propriétaire, `admin` ou `director` | `20260306224500_est372_affaire_brief.sql:97-117`, condition l.114 |

EST-372 remplace les politiques SELECT d'EST-371 par `can_read_*` (`20260306224500_est372_affaire_brief.sql:300-351`), ce qui ouvre la lecture intake aux directeurs après coup.

---

## 2. Modèle de données intake / brief / registre

Toutes les tables du domaine sont créées avec `enable row level security` **et `force row level security`** — la RLS s'applique même au propriétaire de la table : intake (`20260306210000_est371_affaire_intake.sql:265-267`), briefs (`20260306224500_est372_affaire_brief.sql:184-185`), registre (`20260307000500_est373_affaire_register.sql:275-276`), favoris (`20260310113000_affaire_favorites.sql:27`).

Aucune de ces migrations ne crée d'enum Postgres : tous les « enums » sont des contraintes `CHECK` sur des colonnes `text`.

| Table | Colonne d'état | Valeurs autorisées | Référence |
|---|---|---|---|
| `affaire_intake_uploads` | `status` (défaut `queued`) | `queued`, `processing`, `ready`, `partial_failure`, `failed` | `…est371…:10`, CHECK l.15-16 |
| `affaire_intake_documents` | `upload_status` (défaut `pending`) | `pending`, `uploaded`, `rejected` | `…est371…:33`, l.46-47 |
| `affaire_intake_documents` | `classification_status` (défaut `queued`) | `queued`, `processing`, `classified`, `ambiguous`, `failed` | `…est371…:35`, l.48-49 |
| `affaire_intake_documents` | `document_kind` (défaut `a_classer`) | `dpgf`, `plans`, `cctp`, `bpu_dqe`, `annexes`, `emails`, `a_classer` | `…est371…:36`, l.50-51 |
| `affaire_intake_documents` | `classification_source` | `ai`, `heuristic`, `manual` (ou null) | `20260312143000_est436_affaire_intake_classification_source.sql:7-8` |
| `affaire_intake_documents` | `document_priority` (défaut `secondary`) | `primary`, `secondary` | `20260312113000_est435_document_priority.sql:2`, CHECK l.8-9 |
| `affaire_briefs` | `status` (défaut `a_confirmer`) | `a_confirmer`, `confirme` | `…est372…:13`, l.26-27 |
| `affaire_register_entries` | `kind` | `assumption`, `missing_piece` | `…est373…:11`, l.29-30 |
| `affaire_register_entries` | `severity` (défaut `warning`) | `info`, `warning`, `critical` | `…est373…:14`, l.31-32 |
| `affaire_register_entries` | `status` (défaut `open`) | `open`, `validated`, `rejected`, `clarify_with_client` | `…est373…:15`, l.33-34 |
| `affaire_register_entries` | `origin_kind` (défaut `manual`) | `ai`, `manual`, `system` | `…est373…:16`, l.35-36 |
| `affaire_register_entries` | `scope_type` (défaut `project`) | `project`, `lot`, `line`, `exception` | `…est373…:17`, l.37-38 |

Contraintes d'unicité structurantes : `affaire_briefs_project_id_key unique (project_id)` — **un seul brief par affaire** (`…est372…:25`) ; `affaire_register_entries_project_sync_key_key unique (project_id, sync_key)` (`…est373…:27-28`) ; `user_favorite_projects_tenant_user_project_key unique (tenant_id, user_id, project_id)` (`20260310113000_affaire_favorites.sql:11-12`).

`affaire_register_entries_scope_consistency_check` (`…est373…:51-71`) impose la cohérence portée/identifiants : `project` → `version_id`/`scope_id`/`scope_ref` tous nuls ; `lot`/`line` → `version_id` et `scope_id` non nuls, `scope_ref` nul ; `exception` → `version_id` non nul, `scope_id` nul, `scope_ref` non vide. Le trigger `assign_affaire_register_entry_scope` **écrase silencieusement** `version_id`, `scope_id` et `scope_ref` à null quand `scope_type = 'project'` (`…est373…:181-183`).

**`affaire_register_events` est append-only, doublement verrouillé** : trigger `guard_affaire_register_events_immutable` sur UPDATE et DELETE (`…est373…:268-270`, fonction l.242-250, erreur `AFFAIRE_REGISTER_EVENTS_IMMUTABLE`) et absence totale de politiques RLS UPDATE/DELETE (seules SELECT l.329-336 et INSERT l.338-346 existent).

Types d'événements registre, liste finale après quatre élargissements successifs (`20260314110000_est452_affaire_register_follow_up_event.sql:6-18`) : `created`, `synced`, `status_changed`, `follow_up_updated`, `clarify_with_client_requested`, `continued_with_hypothesis`, `revalidation_requested`, `deactivated`, `reactivated`. Miroir TypeScript : `src/lib/affaires/register.ts:23-33`.

Types d'événements intake : les 7 d'origine plus `brief.generated`, `brief.updated`, `brief.confirmed` (`…est372…:280-298`), puis `document.priority_changed` (`20260312113000_est435_document_priority.sql:61`). Miroir TypeScript des 11 valeurs : `src/lib/affaires/intake-server.ts:1140-1151`.

Suppression en cascade : `20260311160000_est446_fix_affaire_delete_with_append_only_events.sql:30-32` perce l'append-only de `estimate_version_events` uniquement pour les DELETE en cascade (`pg_trigger_depth() > 1`), et `20260311160000:1-22` interdit la suppression d'une version non `draft`.

---

## 3. Liste des affaires, tri, pagination, file manager

La liste passe par la RPC `list_affaires_page`, réécrite neuf fois. La signature courante compte **12 paramètres** (`20260713205956_enable_affaire_name_amount_sorting.sql:16-29`) et retourne 16 colonnes (l.30-47), en `stable security invoker` avec `set search_path = ''` (l.48-51).

- `p_limit` : `greatest(1, least(coalesce(p_limit, 20), 101))` — borné [1, 101], défaut 20 (`20260713205956…:54`). La même valeur 101 apparaît à l'identique dans les neuf versions.
- `p_sort_by` normalisé en minuscules : `name` → `name`, `totalhtcents` → `totalHtCents`, **tout le reste (y compris null) → `updatedAt`** (`20260713205956…:56-60`).
- `p_sort_dir` : seule `asc` est reconnue, tout le reste retombe sur `desc` (`20260713205956…:61-64`).
- Le curseur doit correspondre au champ de tri, sinon `AFFAIRES_CURSOR_INVALID` (`20260713205956…:88-106`). Autres erreurs : `AFFAIRES_TENANT_REQUIRED` (l.69), `AFFAIRES_TENANT_MISMATCH` (l.73), `AFFAIRES_OWNER_SCOPE_INVALID` (l.85).
- Tri par nom sur `lower(project_name)` (l.171), par montant sur `coalesce(current_total_ht_cents, 0)` (l.172), avec `project_id` en tie-breaker systématique.
- `revoke execute … from public, anon` puis `grant execute … to authenticated` (l.281-309).

Côté application, `list_affaires_page` est appelée avec `p_limit = query.size + 1` pour détecter `hasNextPage` (`src/lib/affaires/server.ts:1601`, appel l.1603-1618, détection l.1625-1626). `get_affaires_counters` est appelée en `src/lib/affaires/server.ts:1852-1858`.

Paramètres normalisés (`src/lib/affaires/schemas.ts`) : tailles de page `[20, 50, 100]` (l.5) défaut 20 (l.34) ; tris `["updatedAt", "name", "totalHtCents"]` (l.8-12) défaut `updatedAt` (l.35) ; directions `["asc","desc"]` (l.14) défaut `desc` (l.36) ; filtre manager `["all","follow_up","reservations","revalidation"]` (l.16-21) défaut `all` (l.37) ; statuts `["draft","sent","accepted","archived"]` (l.25-30) ; recherche trim max 120 (l.80-87) ; curseur max 512 (l.89-96). **Un `sort`, `dir` ou `manager` invalide est remplacé par le défaut sans aucun signal** via `.catch()` Zod (l.98-106).

File manager (`src/lib/affaires/server.ts:1642-1645`) : `MANAGER_QUEUE_BATCH_SIZE = 10`, `MANAGER_QUEUE_LIST_PAGE_SIZE = 100`, `MANAGER_QUEUE_MAX_PROJECTS = 200`, `MANAGER_QUEUE_TIME_BUDGET_MS = 6_500`. Les dépassements lèvent `MANAGER_QUEUE_PORTFOLIO_LIMIT_EXCEEDED` / `MANAGER_QUEUE_TIME_BUDGET_EXCEEDED` (l.1647-1661). Appelée depuis l'action `fetchAffaireManagerQueueSummaryAction` (`src/app/dashboard/affaires/_actions/manager-queue.ts:6-10`), la deadline vaut `Number.POSITIVE_INFINITY` (`server.ts:1956`) : seule la borne de 200 projets s'applique alors.

Côté client (`src/components/affaires/AffairesPageClient.tsx`) : debounce recherche 400 ms (l.47), timeout de la file manager 8 000 ms (l.46), clé localStorage `"affaires-page-size"` (l.45), et **au-delà de 200 affaires filtrées la file manager passe en `unavailable` sans requête** (l.178-182). Les trois filtres non-`all` sont désactivés tant que l'état n'est pas `ready` ou qu'un `incompleteCount > 0` subsiste (`src/components/affaires/AffairesDenseTable.tsx:249-251`). Le tableau dense n'est rendu qu'en mode UI expert et à partir du breakpoint `xl` (`AffairesPageClient.tsx:582-615`).

**Favoris** — `toggleAffaireFavoriteAction` (`src/app/dashboard/affaires/_actions/favorites.ts:14`) : `upsert` sur `onConflict: "tenant_id,user_id,project_id"` (l.28-37) ou `delete` (l.43-48), donc idempotent des deux côtés ; `revalidatePath("/dashboard/affaires")` (l.55). Il n'exige aucun rôle et **ne vérifie pas que le projet appartient au tenant** — la protection repose entièrement sur la RLS `tenant_id = current_tenant_id() and user_id = auth.uid()` (`20260310113000_affaire_favorites.sql:34-64`).

---

## 4. Création d'affaire

Deux chemins, tous deux réservés aux rôles **`engineer` et `admin`** (`src/app/dashboard/affaires/_actions/quick-create-affaire.ts:99-103`, appelé l.154) : un `director` est refusé en création comme en édition de métadonnées (`src/app/dashboard/affaires/_actions/project.ts:44`).

**Sans import** — `initializeAffaireDraft` (`quick-create-affaire.ts:217`) → `createEstimate` (`src/lib/estimates/server.ts:7223`) : INSERT `estimate_projects` (`server.ts:7300-7312`) puis `estimate_versions` avec `version_number = 1` (l.7339-7341), `status "draft"`, `validite_jours 30`, `margin_multiplier 1`, `margin_mode "fixed"`, `currency "EUR"`, `global_coefficient 1`, **`tax_rate_bp 2000`**, `rounding_mode "none"`, `rounding_step_cents 1` (`src/lib/estimates/server.ts:610-619`), `max_section_depth 3` (`src/lib/estimates/hierarchy.ts:5`) ; puis upsert de 3 catégories et 9 rôles MO à 0 centime (`server.ts:1809-1825`). `createEstimate` comporte des compensations : suppression du projet ou de la version si une étape ultérieure échoue (`server.ts:7406-7408`, `7436-7444`, `7465-7473`).

**Depuis un import DPGF** — `startAffaireFromImport` (`quick-create-affaire.ts:291`) : refus si l'import est déjà lié (l.333), création éventuelle du mapping (l.340-345), normalisation des lignes, puis RPC `create_affaire_from_import_lines` (l.383-396). Cette RPC est en plpgsql donc **atomique** ; elle pose `'Import DPGF'` comme titre de version (`20260305103000_ux2_011_quick_create_from_import.sql:79-82`) et `'Import DPGF DD/MM/YYYY HH24:MI'` comme titre de section (l.84-90), avec `tax_rate_bp 2000` en dur pour la version (l.124-177) et pour chaque ligne (l.244-308). Si **aucune ligne valide** n'est produite, on retombe silencieusement sur une affaire vide simplement liée à l'import (`quick-create-affaire.ts:367-381`).

Piège : `startAffaireFromImport` normalise les lignes avec les constantes `DEFAULT_MARGIN_MULTIPLIER = 1` et `DEFAULT_TAX_RATE_BP = 2000` (`src/lib/affaires/import-flow-server.ts:22-23`, usage `quick-create-affaire.ts:362-365`) et non avec le contexte réel de la version, contrairement au flux d'import unifié qui utilise `fetchVersionComputationContext` (`src/app/dashboard/affaires/_actions/import-flow.ts:319-322`).

`quickCreateAffaire` (`quick-create-affaire.ts:433-436`) termine par un `redirect()` : il ne retourne jamais de valeur. `revalidateQuickCreatePaths` invalide six chemins (`quick-create-affaire.ts:87-97`).

**Flux d'import unifié** — étapes `"upload" | "mapping" | "preview" | "confirmation" | "plans"` (`src/components/affaires/unified-import-flow/types.ts:8`), stepper à 4 étapes ou 5 si takeoff activé (l.10-11). Extensions acceptées `csv, xlsx, xls, pdf` (l.21-24). Champs de mapping obligatoires : `hex_code` et `designation` (l.26-39). `confirmUnifiedImportFlow` (`_actions/import-flow.ts:207`) **n'applique pas `ensureEngineerOrAdmin`** : tout membre du tenant peut confirmer, la restriction ne vient que des filtres `user_id` de `getImportOrThrow` et `assertProjectAccessOrThrow` (`src/lib/affaires/import-flow-server.ts:86-88`, `115-117`). Une garde de concurrence optimiste compare `previewSourceVersionId` à la version courante et refuse si elle a bougé (l.309-317).

**Suppression d'affaire** — `DELETE /api/affaires/[projectId]` (`src/app/api/affaires/[projectId]/route.ts:16`) est le seul handler du segment : il n'y a ni `GET` ni `PATCH` (vérifié : le fichier fait 67 lignes et n'exporte que `DELETE`). Une affaire archivée est **non supprimable** (403, l.41-43) et toutes les versions doivent être `draft` (403, l.46-52). La suppression est un **DELETE dur, irréversible**, sans soft-delete (l.54-57), avec cascade sur `estimate_versions` (`supabase/migrations/001_add_job_title_to_profiles.sql:232`). Le `.delete()` filtre uniquement sur `id`, **sans `.eq("tenant_id", …)`** (l.54-57) : l'isolation repose sur le SELECT préalable et la RLS.

---

## 5. Intake : dépôt et classification des pièces

**Stockage.** Bucket `affaire-intake`, non public (`src/lib/affaires/intake.ts:3` ; création `…est371…:407-427`). Chemin : `tenantId/projectId/uploadId/documentId/<nom sanitisé>` (`intake.ts:462-476`, sanitisation l.451-460) ; les politiques storage exigent exactement 4 dossiers (`…est371…:440`). Le SELECT storage exige en plus `upload_status = 'uploaded'` (`…est371…:451`).

Limites, valeurs exactes :

| Limite | Valeur | Référence |
|---|---|---|
| Taille par fichier | 50 Mio | `src/lib/affaires/intake.ts:4` ; bucket `52428800` `…est371…:412` |
| Fichiers par lot | 20 | `src/lib/affaires/intake-server.ts:313`, contrôle l.2241-2245 |
| Volume cumulé du lot | 100 Mio | `intake-server.ts:314`, contrôle l.2247-2250 |
| Corps multipart HTTP | 105 Mio | `src/app/api/affaires/[projectId]/intake/files/route.ts:15`, vérifié l.23-29 puis l.45-50 |
| Extensions acceptées (12) | `pdf, png, jpg, jpeg, webp, txt, csv, eml, xls, xlsx, doc, docx` | `intake.ts:7-20` |
| MIME acceptés (11) | voir liste | `intake.ts:22-34` ; miroir SQL `…est371…:414-424` |
| Snippet texte envoyé à l'IA | 12 000 caractères | `intake-server.ts:312` |
| Garde-fous tableur (anti zip-bomb) | 10 Mio entrée, 512 entrées, 32 Mio décompressé, 16 Mio par entrée, ratio 100, 32 feuilles, 20 lignes/feuille | `intake-server.ts:315-321`, contrôles l.747-864 |

`validateFileForUpload` est appelé avec `allowEmptyMimeType: true` (`intake-server.ts:2318`) : un fichier au MIME vide franchit le filtre MIME.

**Route de dépôt** — `POST /api/affaires/[projectId]/intake/files` (`route.ts:62`, `runtime = "nodejs"` l.10). Accès : propriétaire ou `admin` (`intake-server.ts:1114-1123`) — **les `director` sont exclus du dépôt** alors qu'ils peuvent lire et éditer le brief. Retour **201** même quand **tous** les fichiers ont été rejetés, chaque entrée portant `status: "rejected"` (l.103-109). Le traitement est déclenché hors réponse via `after()` (l.89-101). L'upload finit en `failed` avec `last_error = "Aucun fichier n'a pu etre televerse."` si rien n'a pu être stocké (`intake-server.ts:2463-2477`).

**Classification.** Modèle `gemini-3-flash-preview`, prompt `est371_affaire_intake_v1`, thinking `low` (`intake-server.ts:306-308`). **Aucun feature flag ne protège la classification IA ni la génération du brief** (vérifié : le seul flag consulté dans le périmètre intake est `TAKEOFF_MODULE_ENABLED` dans `intake-plan-sync.ts:343`).

Heuristiques, appliquées **uniquement sur le nom de fichier normalisé** (`intake.ts:482`) : `emails` 0.99 par MIME/extension `eml` (l.486-494) ou 0.96 par mot-clé (l.351-352) ; `dpgf` 0.92 (l.356-363) ; `bpu_dqe` 0.91 (l.367-373) ; `cctp` 0.89 (l.377-383) ; `plans` 0.84 (l.387-395) ; repli PDF → `annexes` 0.42 (l.508-515) ; repli final → `a_classer` 0.35 (l.517-522). Fusion IA/heuristique : si l'IA répond `a_classer` et que l'heuristique donne autre chose avec une confiance **≥ 0.8**, l'heuristique l'emporte (l.525-551). Statut final : confiance **< 0.65** → `ambiguous` (l.553-572). Le reclassement manuel force la confiance à **1**, ou **0.4** si la cible est `a_classer` (`intake-server.ts:3136-3139`), et pose `classification_source: "manual"` (l.3162).

`doc` et `docx` sont acceptés au dépôt mais **ne sont jamais envoyés à l'IA** : ils ne figurent pas dans la liste des MIME analysables (`intake.ts:439-449`), le payload retombe donc sur l'heuristique de nom de fichier (`intake-server.ts:1004-1015`).

**Priorité primary/secondary** : seuls `dpgf` et `cctp` sont éligibles (`intake.ts:327-331`, contrôle `intake-server.ts:3269-3273`). En l'absence de marquage, le plus ancien `created_at` gagne (`intake-server.ts:503-516`). `setAffaireDocumentAsPrimary` rétrograde en masse tous les `primary` de la catégorie avant de promouvoir (l.3305-3312).

**Pièces manquantes** — dérivées des seules pièces `uploaded` + `classified` (`intake.ts:653-659`) : `missing_dpgf` **critical** (l.663-668), `missing_plans` **critical** (l.671-677), `missing_cctp` warning (l.679-685), `missing_bpu_dqe` warning (l.687-693). Le snapshot de readiness distingue les manques « provisoires » (susceptibles d'être levés par une revue de classement) des manques confirmés, via un appariement mémoïsé sur bitmask (`intake.ts:730-836`, snapshot l.838-904).

**Idempotence et reprise.** `processAffaireIntakeUpload` sort tôt si `upload.status !== "queued"` (`intake-server.ts:2531-2533`). `attempt_count` est incrémenté mais **`next_retry_at` est systématiquement remis à `null`** (l.2544) et aucun planificateur ne le lit : un upload bloqué en `processing` n'est jamais repris. **Aucun hash ni déduplication de contenu** (vérifié : `file_hash: null` est écrit en dur, `intake-plan-sync.ts:326`) — deux dépôts du même fichier créent deux documents. **Aucune URL signée** dans le périmètre intake : les accès storage passent par `.download()` direct (`intake-server.ts:2650`, `intake-plan-sync.ts:281`). **Aucun TTL ni purge** des documents intake.

---

## 6. Brief IA

Un brief par affaire (contrainte `unique (project_id)`, `…est372…:25`). Modèle `gemini-3-flash-preview`, prompt `est372_affaire_brief_v1`, thinking `low` (`intake-server.ts:309-311`). Le prompt reçoit uniquement l'inventaire textuel des documents (`documentId`, `fileName`, catégorie détectée, confiance, métadonnées, anomalies) et la liste des pièces manquantes (`intake-server.ts:1408-1463`) : **aucun fichier binaire n'est joint** (appel l.1908-1920).

Bornes du schéma structuré (`intake-server.ts:326-344`) : `scope ≤ 12`, `lots ≤ 20`, `receivedPieces ≤ 20`, `assumptions ≤ 12`, `vigilancePoints ≤ 12`, `missingElements ≤ 12`, chaque entrée `text` de 1 à 320 caractères avec au plus 6 `sourceDocumentIds`.

Un brief de repli **déterministe** est toujours construit (`intake-server.ts:1248-1406`, seuil interne 0.65 l.1272). Si l'appel Gemini échoue, l'erreur est loguée et le repli est publié comme un brief normal (l.1923-1929). Les `receivedPieces` du repli sont **toujours** conservées, même quand l'IA en propose (l.1551).

Blocs sources autorisés dans `affaire_brief_source_links` : `summary`, `project_object`, `scope`, `lots`, `received_pieces`, `assumptions`, `vigilance_points`, `missing_elements` (`…est372…:60-72`).

**Piège majeur : la confirmation humaine est réversible sans intervention.** `persistAffaireBriefDraft` compare un JSON canonique (`intake-server.ts:1793-1810`) ; si le contenu régénéré diffère ou si l'`uploadId` change, le brief repasse en `a_confirmer` et `confirmed_at`/`confirmed_by` sont effacés (l.1961-1971). Un simple dépôt de fichier supplémentaire peut donc invalider un brief confirmé. L'édition manuelle force le même retour à `a_confirmer` (l.2995-2997).

`replaceAffaireBriefSourceLinks` supprime **toutes** les lignes du brief avant réinsertion, sans transaction (`intake-server.ts:1653-1682`) : un échec d'insert perd les sources.

---

## 7. Synchronisation intake → plans (métré)

`syncTakeoffPlanSetFromAffaireIntake` (`src/lib/affaires/intake-plan-sync.ts:338`) sort immédiatement si `isTakeoffEnabled` est faux (l.343-352). Éligibilité : `upload_status = "uploaded"` ET `classification_status = "classified"` ET `document_kind = "plans"` ET `storage_path` non nul ET PDF (l.91-106). Le jeu de plans cible est celui portant `default_import_plan_set` (l.147-160), avec repli sur le nom exact `"Plans import"` **uniquement s'il existe exactement un candidat** (l.155-159). Déduplication par `intake_document_id` en metadata (l.380-386).

**Effet irréversible.** Tout `plan_files` marqué `source === "affaire-intake"` dont le document n'est plus éligible est **supprimé du storage puis de la table** (l.389-397, suppression l.239-267). Reclasser un PDF « plans » vers une autre catégorie détruit donc définitivement le fichier de plan correspondant.

**Piège d'orchestration.** `refreshAffaireBriefFromDocuments` ne transmet que les documents de l'upload courant (`intake-server.ts:2112`), alors que la synchro traite la liste reçue comme la vérité complète et supprime tout plan file intake absent (`intake-plan-sync.ts:388-397`) : appelée depuis `processAffaireIntakeUpload` (documents filtrés par `upload_id`, `intake-server.ts:2760`), elle rend les plans d'uploads antérieurs candidats à la suppression. L'échec de la synchro — y compris ces suppressions — est **avalé** et le traitement continue (`intake-server.ts:2114-2120`).

---

## 8. Registre d'hypothèses et de pièces manquantes

**Sources d'alimentation.** `syncAffaireRegisterFromBrief` (`src/lib/affaires/register-server.ts:1327`) écrit les hypothèses du brief en `origin_kind: "ai"`, `severity: "warning"`, `scope_type: "project"` (l.1348-1350). `syncAffaireRegisterMissingPieces` (l.1368) écrit les pièces manquantes en `origin_kind: "system"`. `sync_key` = `` `${prefix}:${texte normalisé sur 240 caractères en minuscules}` `` (l.986-988), sur le **texte** pour les hypothèses (l.1353) et sur le **code** pour les pièces manquantes (l.1385).

**Asymétrie de désactivation** : `syncAffaireRegisterFromBrief` passe `deactivateMissing: false` (l.1364), donc **les hypothèses IA devenues obsolètes ne sont jamais désactivées** ; les pièces manquantes le sont (l.1038-1102). Pour `origin_kind = "system"`, une entrée désactivée dont le statut n'est pas `validated` est **forcée à `validated`** (l.1077-1080).

**Préservation du travail manuel** : le statut d'une entrée active est conservé lors d'une resynchronisation (l.1137-1138), de même que la sévérité surchargée manuellement via `severityDecision.mode === "manual"` (l.1143-1148, l.539-544) et les objets `clientClarificationRequest` / `continuationDecision` / `revalidationRequest` (l.1183-1194). En revanche, **réactiver une entrée purge toute cette métadonnée de workflow** et repasse le statut à `open` (l.583-592, event `reactivated` l.1287).

**Transitions serveur autoritaires** :

| Action | Depuis | Vers | Événement | Référence |
|---|---|---|---|---|
| Création manuelle | — | `open` | `created` | `register-server.ts:1973`, statut l.1998, event l.2055 |
| Changement de statut | tout ≠ cible | `validated` / `rejected` / `open` | `status_changed` | l.2070, event l.2159 |
| Clarification client | **`open` uniquement** | `clarify_with_client` | `clarify_with_client_requested` | garde l.2103-2107, event l.2158 |
| Revalidation | `validated` / `rejected` uniquement | `open` | `revalidation_requested` | garde l.2399-2403, patch l.2449, event l.2452 |
| Continuer avec hypothèse | `missing_piece` + `open` | **statut inchangé** | `continued_with_hypothesis` | garde l.2501-2505, patch l.2673-2675 |
| Pilotage (sévérité / responsable / échéance) | tout | inchangé | `follow_up_updated` | l.2185, event l.2351 |

« Continuer avec hypothèse » **crée une seconde entrée** de type `assumption` clonant la portée de la pièce manquante (l.2571-2608), laquelle **reste `open`**. Les trois écritures ne sont pas transactionnelles : un échec après l'insert laisse une hypothèse orpheline (l.2571, 2623, 2669).

Les objets de workflow sont mutuellement exclusifs par suppression : passer en revalidation supprime `clientClarificationRequest` (l.2423-2425), et toute transition vers un statut ≠ `open` supprime `revalidationRequest` (l.2127-2129). **Ces objets ne sont pas archivés** ; seuls les `before_payload` des événements en gardent une trace partielle.

**Escalade de privilèges par conception** : `updateAffaireRegisterEntryWithEvent` exécute la RPC `update_affaire_register_entry_with_event` via `createServiceRoleClient()` (l.961-965), donc **hors RLS**. Le contrôle d'accès repose entièrement sur `requireAffaireRegisterProjectAccess` en amont (l.794-829 : lecture = propriétaire/`admin`/`director`, écriture = propriétaire/`admin`).

**Gating.** Le registre ne bloque rien lui-même mais alimente deux mécanismes. Côté envoi de devis (`src/lib/estimates/gating.ts:407`), quatre drapeaux sont bloquants : `critical_missing_pieces`, `critical_open_questions`, `client_missing_documents_required`, `client_clarification_required` (l.721-770) ; deux sont des avertissements (l.771-795). Côté readiness pré-remise (`src/lib/estimates/rules-engine.ts:1751-1795`), seules les entrées **critiques** bloquent, les `clarify_with_client` n'étant que des alertes (l.1797-1884) — asymétrie assumée entre les deux moteurs.

**Piège de gating** : les entrées en revalidation sont **exclues des buckets standards** (`register-server.ts:1494-1496`). Une entrée critique passée en revalidation ne compte donc plus dans `criticalOpenEntries` et **ne déclenche aucun drapeau bloquant**. En complément, `revalidationBlocksEstimation` est câblé à `false` en dur (l.1605).

**Divergence de robustesse** : `fetchAffaireRegisterGateSummary` utilise `.parse()` strict et **lève** sur une valeur d'enum inconnue (l.1420-1425), là où le reste du module filtre silencieusement les lignes invalides (l.1032-1034, 1727-1728). Une valeur inattendue en base casse le gating au lieu de le dégrader.

Valeurs codées en dur : pagination registre défaut 8, max 25 (l.254-255) ; timeline défaut 12, bornée [1, 25] (l.1631) ; texte d'entrée et commentaires max 320 caractères (l.262, 310, 320) ; `scopeRef` 120, `scopeLabel` 180, `sourceFileName` 255, `code` 120 (l.266-270) ; étapes impactées de 1 à 5 (l.341-342) ; rôles assignables `["admin","director","engineer"]` (l.839) ; aperçu de 3 entrées dans le message de signal (l.2703).

**Il n'existe aucun délai de relance ni calcul de retard** (vérifié : `grep -n "FOLLOW_UP_DAYS\|dueDate <" src/lib/affaires/` → 0 résultat). `followUp.dueDate` est validé comme simple date (`register-server.ts:319`), sans contrainte de date future, et n'est utilisé que pour trier l'export de revue avec le repli `"9999-12-31"` (`register.ts:1064-1065`). Aucune notification n'est émise.

Server actions : `src/app/dashboard/affaires/_actions/register.ts:129, 148, 167, 190, 215, 233`. Toutes sauf `fetchAffaireRegisterReviewExportAction` appellent `revalidateAffaireRegisterPaths` (l.120-127) qui invalide `/dashboard/affaires`, `/dashboard/affaires/{projectId}` et, si connu, `/dashboard/estimates/{versionId}`. Le schéma des actions **omet `code`** alors que la couche lib l'accepte (`_actions/register.ts:24-94` vs `register-server.ts:270`) : `code` n'est pas transmissible depuis l'UI.

---

## 9. Hub affaire

`fetchAffaireHubPageData` (`src/lib/affaires/server.ts:2040`) charge le projet via `fetchAffaireHubProjectOrThrow` (l.864) — filtré `tenant_id` et **`is_archived = false`** (l.873), avec restriction `user_id` si le rôle n'est ni `admin` ni `director` (l.875-878) — puis agrège summary, timeline et source DPGF en parallèle (l.2048-2055). La timeline des versions est figée à **20 par page** : le hub ne passe jamais `pageSize` (l.2018-2021) et le défaut vaut 20, max 100 (`src/lib/estimates/server.ts:622-623`).

**Readiness du hub** — `buildAffaireHubReadinessSnapshot` (`src/lib/affaires/server.ts:659-820`). Statuts : `not_ready`, `ready_with_reservations`, `ready` (l.781-799). Règles, dans l'ordre d'évaluation : un document à revoir → `not_ready` (l.782) ; absence de base de travail → `not_ready` (l.784) ; pièce critique confirmée ou réserve registre critique → `ready_with_reservations` si la base de travail est établie, sinon `not_ready` (l.786-790) ; sinon toute réserve secondaire ou brief non confirmé → `ready_with_reservations` (l.791-798). La « base de travail » est établie si le brief est confirmé, ou si une structure préliminaire est ouvrable, ou si `lineCount > 0`, ou s'il existe au moins une continuation sous hypothèse (l.768-772). Sept codes de `drivers` sont émis : `review_pending`, `brief_missing`, `brief_to_confirm`, `critical_missing_piece`, `warning_missing_piece`, `client_clarification`, `continued_with_hypothesis`, `revalidation_required` (l.693-766).

**Piège** : la readiness n'est calculée que si l'intake **et** le registre sont tous deux disponibles (l.1028). Or les deux appels sont enveloppés dans `.catch(() => null)` (l.978, 985) : une panne de l'un fait disparaître silencieusement l'indicateur de readiness de l'interface au lieu d'afficher une erreur.

**Stepper** — six étapes séquentielles (`src/components/affaires/affaire-workflow.ts:5-11`) : `dossier`, `brief`, `dpgf`, `devis`, `validation`, `envoi`, avec leurs règles de complétion l.48-59. La progression est **strictement séquentielle** : dès qu'une étape n'est pas `done`, toutes les suivantes passent en `upcoming` même si elles sont réalisées (l.61-71). `validation` est `done` si l'approbation vaut `approved` ou `not_required` (l.34-38).

**Pilotage** — `buildPilotageSteps` (`src/components/affaires/AffairePilotagePanel.logic.ts:758-1063`) produit toujours cinq étapes (`dossier`, `brief`, `devis`, `metre`, `validation`, l.1051-1062), avec quatre statuts `done | in_progress | blocked | waiting` (l.25). `buildPilotageExceptions` (l.1065-1338) émet quatorze exceptions identifiées, triées par rang de sévérité `critical:0 / warning:1 / info:2` (l.1324-1328) puis alphabétiquement en locale `fr` (l.1336). Les quatre branches registre sont mutuellement exclusives (`else if` chaînés l.1157, 1176, 1201, 1222), de même que les quatre branches takeoff (l.1243, 1257, 1276, 1289) : **une seule exception registre et une seule exception takeoff peuvent apparaître à la fois**.

**Analyse de marge** — seuils codés en dur `{ good: 25, fair: 15 }` (`src/components/affaires/MarginAnalysisWidget.tsx:13`), classification l.15-19. Les mêmes seuils sont **dupliqués** dans le hub (`src/components/affaires/AffaireHub.tsx:815, 817`). Le graphe d'évolution n'apparaît qu'à partir de deux versions (l.374) et plafonne son axe à un minimum de 30 (l.244). Le calcul de marge consulte le flag `EST_031_LABOR_SPLIT` (`src/lib/affaires/server.ts:2307-2311`) — seul feature flag du module `affaires/server.ts`.

**Ordre de rendu du hub** (`src/components/affaires/AffaireHub.tsx:1636-2125`) : fil d'Ariane, bannière d'onboarding, bannière « Mode revue » si `isReadOnlyReview`, fiche projet, stepper mobile, bannière d'import, puis — si `showImportFlow` est actif, **le flux d'import remplace tout le reste** (l.1842-1848) — sinon prompt takeoff, panneau hiérarchie (toujours), panneau pilotage, bandeau de progression, alertes, puis une grille à deux colonnes : à gauche `IntakeWorkspace` (`#intake`), `BriefDraftCard` (`#brief`), résumé financier (`#financial`), widget de marge (mode expert seulement), source DPGF (`#dpgf`), timeline ; à droite `AffaireRegisterCard` (`#register`), approbation (`#approval`), journal de décision, `PlansMetresCard` (`#plans`). Le stepper desktop est collé en bas (l.2096-2106). Le mode lecture seule correspond au rôle `director` (`src/app/dashboard/affaires/[projectId]/page.tsx:189`).

Beaucoup de sections sont masquées par `isFreshStartState` : zéro document, pas de DPGF et `lineCount === 0` (`AffaireHub.tsx:144-154`).

**Lancement du métré** — `LaunchMetreDialog` (`src/components/affaires/LaunchMetreDialog.tsx`) propose uniquement les niveaux **B** et **C** (l.21-34) ; le niveau A est refusé côté serveur avec un 422 (`src/lib/takeoff/server.ts:8274-8283`). Le lancement exige un jeu de plans par défaut avec au moins un fichier (l.251-253, l.208) et une version cible (l.207, l.531). Depuis une version source, l'action duplique d'abord la version puis lance le job, avec un rollback compensatoire dont **l'échec n'est que logué**, laissant une version orpheline possible (`src/app/dashboard/affaires/_actions/takeoff.ts:34-54`, l.96-105). Le déclenchement du traitement a un timeout de 1 500 ms (`src/lib/takeoff/edge-trigger.ts:17`) et **ne remonte jamais son échec** : le job existe mais peut ne jamais démarrer (l.46-57, 80-92).

---

## 10. Pages et routage

Aucune page du domaine ne déclare `dynamic`, `revalidate` ou `metadata` (vérifié : aucun match dans `src/app/dashboard/affaires`). Le caractère dynamique vient du layout parent `src/app/dashboard/layout.tsx:6` (`force-dynamic`). Le layout du segment `[projectId]` est un simple pass-through (`src/app/dashboard/affaires/[projectId]/layout.tsx:1-7`).

`src/app/dashboard/affaires/page.tsx` lit les `searchParams` (Promise, l.38) via `parseAffaireListQuery` (l.39) et enveloppe le résultat dans un `Suspense` (l.41-45). `src/app/dashboard/affaires/[projectId]/page.tsx` résout params, searchParams et contexte utilisateur en parallèle (l.49-59), `notFound()` si aucun tenant (l.61-63) ou si le summary remonte `NOT_FOUND` (l.124-135), puis exécute deux vagues de `Promise.allSettled` (6 promesses l.108-122, puis 8 l.139-179) et une troisième vague conditionnelle si takeoff est activé (l.260-276). Les échecs partiels deviennent des `sectionErrors` textuels (l.224-252).

Le segment `new` est statique et prioritaire sur `[projectId]` (`src/app/dashboard/affaires/new/page.tsx:1-5`). `normalizeAffaireProjectId` (`src/lib/affaires/route-segments.ts:3`) rejette `new` et les segments contenant `/ \ ? #` (l.9-20) — mais **cette garde n'a aucun consommateur en production** (vérifié : seul `route-segments.test.ts` l'importe).

Le paramètre `?devHubScenario` active dix-neuf scénarios de démonstration (`src/lib/affaires/hub-dev-scenarios.ts:27-47`) et n'est lu que hors production (`src/app/dashboard/affaires/[projectId]/page.tsx:67-70`).

Couverture end-to-end du domaine : `e2e/estimates/affaire-pilotage-panel.spec.ts`, `affaire-recovery-flow.spec.ts`, `hub-launch-metre.spec.ts`, `hub-plans-card.spec.ts`, `hub-takeoff-auto-propose.spec.ts`, `import-flow-carry-over.spec.ts`, `team-a-hub-prod.spec.ts`, `team-b-user-stories.spec.ts`, `cockpit-command-bar.spec.ts`.

---

## 11. Pièges récapitulés

1. **Un dépôt de fichier peut annuler une confirmation de brief** : régénération avec contenu différent → retour à `a_confirmer` et effacement de `confirmed_at`/`confirmed_by` (`intake-server.ts:1961-1971`).
2. **Un reclassement de document supprime définitivement des fichiers de plans** dans le bucket `plan-files` (`intake-plan-sync.ts:389-397`, suppression l.248-250), et l'échec de cette opération est avalé (`intake-server.ts:2114-2120`).
3. **Une entrée de registre en revalidation ne bloque plus rien** : elle est exclue des buckets de gating (`register-server.ts:1494-1496`) et `revalidationBlocksEstimation` vaut `false` en dur (l.1605).
4. **Les hypothèses IA obsolètes ne sont jamais désactivées** (`register-server.ts:1364`), contrairement aux pièces manquantes.
5. **Réactiver une entrée de registre efface son historique de workflow** en métadonnée (`register-server.ts:583-592`).
6. **La suppression d'affaire est un DELETE dur en cascade**, sans filtre `tenant_id` sur le `.delete()` (`src/app/api/affaires/[projectId]/route.ts:54-57`).
7. **Un upload intake bloqué en `processing` n'est jamais repris** : `next_retry_at` est toujours remis à `null` et aucun planificateur ne le lit (`intake-server.ts:2544`).
8. **`doc`/`docx` sont acceptés mais jamais analysés par l'IA** (`intake.ts:439-449`), donc classés au seul jugé du nom de fichier.
9. **Un paramètre de tri invalide est silencieusement remplacé** par le défaut, côté Zod (`schemas.ts:98-106`) comme côté SQL (`20260713205956…:56-64`).
10. **La readiness du hub disparaît silencieusement** si l'intake ou le registre échoue (`src/lib/affaires/server.ts:978, 985, 1028`).
11. **Les favoris n'ont aucun contrôle applicatif de propriété** ; seule la RLS protège (`_actions/favorites.ts:14-48`).
12. **Les écritures registre contournent la RLS** via le client service-role (`register-server.ts:961`) ; le contrôle d'accès applicatif est le seul rempart.
13. **`fetchAffaireIntakeWorkspace` mélange deux périmètres** : l'`uploadId` retourné est celui du dernier upload (`intake-server.ts:2821-2832`) alors que les documents sont chargés pour tous les uploads du projet (l.2870).
14. **La création rapide depuis un import utilise des constantes de calcul** (marge 1, TVA 2000 bp) et non le contexte de la version (`quick-create-affaire.ts:362-365`).
15. **`director` peut lire et éditer un brief mais ne peut pas déposer de pièce** : `can_read_*` couvre l'écriture des briefs (`…est372…:201-223`) alors que le dépôt exige propriétaire ou `admin` (`intake-server.ts:1114-1123`).
