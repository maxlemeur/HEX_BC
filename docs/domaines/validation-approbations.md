# Validation, approbations et pilotage

> **Statut : workflow d'approbation et gating relus au 2026-08-12.** Les
> autres sections conservent les références détaillées de la photographie du
> 2026-07-29. En cas de divergence, le code et les migrations font foi.

Ce document détaille le moteur de règles, le gating d'envoi, le cycle d'approbation, le journal de décision, la vue direction, la barre de commande cockpit et les KPI analytics. Le cadre général (statuts, immutabilité, scellement) est décrit dans [cycle-de-vie.md](../metier/cycle-de-vie.md) et n'est pas répété ici.

---

## 1. Cartographie des surfaces

| Surface | Point d'entrée | Rôles autorisés |
|---|---|---|
| Moteur de règles | `src/lib/estimates/rules-engine.ts:1376` (`evaluateRules`) | interne |
| CRUD des règles | `src/app/dashboard/admin/rules/page.tsx:229-234` | `admin` seul |
| Gating d'envoi | `src/lib/estimates/gating.ts:369` | propriétaire ou `admin` |
| Résumé d'approbation | `src/lib/estimates/rules-engine.ts:3646` | propriétaire, `admin`, `director` |
| Soumission / décision | `src/lib/estimates/rules-engine.ts:4326` | voir §5.1 |
| Journal de décision | `src/lib/estimates/rules-engine.ts:3016` | idem lecture résumé |
| File d'approbation | `src/lib/approvals/server.ts:143` | `admin`, `director` |
| Vue direction | `src/lib/direction/server.ts:1008` | `admin`, `director` |
| Cockpit (barre de commande) | `src/lib/cockpit/suggestions.ts:204` | tout membre |
| Analytics | `src/lib/analytics/server.ts:285` | tout membre (portée restreinte) |

Routes exposées : `GET /api/estimates/[versionId]/gating` (`gating/route.ts:15-26`), `GET /api/estimates/[versionId]/approval` (`approval/route.ts:15-26`), `GET /api/estimates/[versionId]/approval-journal?author&status&format` (`approval-journal/route.ts:13-19,35-62`). Server Actions : `_actions/estimate-approval.ts:19,38,66,83`, `_actions/approval-queue.ts:8`, `_actions/direction.ts:11,22`.

---

## 2. Le moteur de règles

### 2.1 Modèle

Table `estimate_rules` — `supabase/migrations/20260223110000_est037_estimate_rules_engine.sql:35-47` : `rule_type`, `scope_type` (défaut `global`), `scope_id`, `threshold_value` (`check >= 0`, `:46`), `action`, `is_active` (défaut `true`). Table `estimate_approvals` — `:54-76` : un `pending` ne peut porter ni `approved_by` ni `decided_at`, un `approved`/`rejected` doit porter `decided_at` (`:65-75`). Un index unique partiel garantit **une seule approbation `pending` par (tenant, version, règle)** (`:85-87`).

### 2.2 Les 7 types de règles

Trois types à l'origine (`:5`), quatre ajoutés par `supabase/migrations/20260306143000_v3_015_director_approval_workflow.sql:25-55`. Résolution de la métrique : `rules-engine.ts:1158-1271`.

| `rule_type` | Métrique | Comparateur | Violée si | Source du signal |
|---|---|---|---|---|
| `min_margin` | marge effective en points de base | `>=` | valeur `<` seuil | résolveur versionné (voir §3) |
| `max_discount` | `discount_bp` | `<=` | valeur `>` seuil (`:1133-1141`) | version |
| `require_approval` | `total_ht_cents` | `<=` | valeur `>` seuil (`:1143-1151`) | version |
| `dpgf_coverage_min` | `dpgf_coverage_bp` | `>=` | valeur `<` seuil (`:1198-1215`) | `takeoff_dpgf_links` (`:1095-1118`) |
| `takeoff_evidence_coverage_min` | `takeoff_evidence_coverage_bp` | `>=` | valeur `<` seuil (`:1217-1234`) | `takeoff_items.evidence` (`:1068-1093`) |
| `critical_exceptions_max` | `critical_exceptions_count` | `<=` | **jamais** (`:1236-1242`) | aucune |
| `missing_line_evidence_max` | `missing_line_evidence_count` | `<=` | **jamais** (`:1244-1250`) | aucune |

> `critical_exceptions_max` et `missing_line_evidence_max` retournent inconditionnellement `sourceState: "unavailable"` (`rules-engine.ts:1236-1250`) ; `loadRuleSignalContext` initialise d'ailleurs les deux compteurs à `null` sans jamais les remplir (`:1047-1052`). Ces deux types sont configurables dans l'écran admin (`admin/rules/page.tsx:32-39`) mais **ne peuvent produire qu'un signal d'indisponibilité**, jamais une violation chiffrée.

Couverture DPGF et couverture de preuves ne sont calculées que si au moins une règle du tenant les demande (`:1037-1055`), et restent `null` si aucun job takeoff n'est rattaché à la version (`:1064-1066`).

### 2.3 Portées, actions, sévérité

`isRuleInScope` (`:935-963`) : `global` s'applique toujours (`:942-944`) ; `category` exige que `scope_id` figure parmi les `category_id` des lignes (`:946-952`) ; `client` exige `scope_id === project.id` (`:954-960`).

> La portée `client` compare le `scope_id` à l'**identifiant du projet**, pas à un identifiant de client. Une règle « client » est en pratique une règle « affaire ».

Sévérité : `warn` ⇒ `warning`, `block` et `require_approval` ⇒ `blocking` (`resolveSeverityForRuleAction`, `:1153-1156`). Toute règle dont `action = require_approval` **ou** `rule_type = require_approval` est une règle d'approbation (`isApprovalRule`, `:965-967`) et sa violation est forcée en `blocking` quelle que soit l'action (`:1534-1536`).

### 2.4 Seuils et CRUD

Aucun seuil n'est codé en dur : `threshold_value` est lu tel quel, normalisé (`:782-788`) puis replié sur `0` s'il n'est pas numérique (`:1400-1405`). Les valeurs sont interprétées en points de base pour marges, remises et couvertures (`formatPercentBp`, `:802-804`) et en centimes pour `require_approval` (`formatEuroCents`, `:806-808`). L'écran admin propose `step="0.01"` et `min="0"` (`admin/rules/page.tsx:285-293`).

`listEstimateRulesForCurrentTenant` (`:4767`), `create` (`:4789`), `update` (`:4831`) et `delete` (`:4896`) appellent tous `assertAdminRole` (`:3801-3806`) ; la RLS double le garde-fou, lecture ouverte à tout membre et écriture réservée à `admin` (`20260223110000…:284-295`). Il n'existe **aucune route API** pour ce CRUD : `find src/app/api -type f -name route.ts | grep -i rule` ne renvoie que `suggestion-rules` et `takeoff/mapping-rules`.

---

## 3. Marge effective gouvernée par version de moteur

`resolveEffectiveMarginBp` (`src/lib/estimates/effective-margin.ts`) fournit une
seule métrique aux règles et aux surfaces de pilotage :

```text
v1 : margin_bp stocké
     └─ repli sur margin_multiplier historique

v2 : snapshot frais
     └─ calc_snapshot_context.effective_margin_multiplier
        si calc_snapshot_content_revision === content_revision
     sans snapshot frais
     ├─ brouillon fixed : repli sur margin_multiplier configuré
     └─ brouillon tiered : marge indéterminée
```

La conversion du coefficient en taux de marque est
`max(0, round((1 - 1 / coefficient) × 10 000))`. Par exemple, ×1,25 donne
2 000 bp, ×1,40 donne 2 857 bp et ×1,60 donne 3 750 bp.

Pour une v2, le breakdown calcule d'abord le coefficient réellement appliqué.
En mode `fixed`, il s'agit du coefficient configuré. En mode `tiered`, il
s'agit du palier choisi à partir du coût calculé, y compris lorsque le barème
par défaut est matérialisé parce que le tenant n'a aucune tranche. Le gel écrit
ce coefficient dans `calc_snapshot_context.effective_margin_multiplier`. Cette
valeur n'est autoritative que si
`calc_snapshot_content_revision === content_revision` : un snapshot périmé est
ignoré. Une version contractuelle fraîche ne dépend donc pas d'un barème
modifié après sa revue ou son envoi.

Le moteur de règles `min_margin`, les cartes et alertes Direction et la file
d'approbation utilisent ce résolveur commun. Le gating charge aussi
`margin_bp` **et** `discount_bp` ; `max_discount` n'est donc plus neutralisé par
une remise absente ramenée à zéro.

La RPC `list_approval_queue` applique le même contrat côté SQL : `margin_bp`
historique pour v1, coefficient d'un snapshot **frais** converti en points de
base pour v2, sinon `null`. Le tri `margin` et le repli de la file en cas
d'échec de l'enrichissement Direction restent donc cohérents avec la marge
effective.

Limites conservées : les v1 restent volontairement gouvernées par leur
`margin_bp` historique. Un brouillon v2 `fixed` non gelé peut encore être lu à
partir de son coefficient configuré. Un brouillon v2 `tiered` sans snapshot
reste volontairement indéterminé : le coefficient de configuration ne prouve
pas quel palier a été appliqué. Le prochain gel produit la source effective
durable. Dans cet état incomplet, `min_margin` traite l'absence comme `0` pour
bloquer de façon conservatrice ; Direction et la file exposent `null` pour ne
pas afficher une marge inventée.

---

## 4. Gating d'envoi — les 19 drapeaux

`ESTIMATE_GATING_FLAG_KEYS` = 8 drapeaux qualité (`src/lib/estimate-quality.ts:9-18`) + 11 drapeaux propres au gating (`gating.ts:42-55`). Sévérités par défaut : `gating.ts:128-151`. Catégories de préparation : `readiness.ts:26-45`.

| # | Clé | Défaut | Catégorie | Déclencheur | Surchargeable ? |
|---|---|---|---|---|---|
| 1 | `missing_price` | blocking | `estimate_quality` | prix FO absent ou nul (`estimate-quality.ts:31-34`) | oui |
| 2 | `missing_quantity` | blocking | `estimate_quality` | quantité absente ou nulle (`:35-38`) | oui |
| 3 | `missing_labor_time` | warning | `estimate_quality` | temps MO absent ou nul (`:39-42`) | oui |
| 4 | `missing_labor_role` | warning | `estimate_quality` | temps MO sans rôle (`:43-47`) | oui |
| 5 | `supplier_price_outdated` | warning | `estimate_quality` | prix fournisseur périmé (`:48-52`, calcul `gating.ts:455-483`) | oui |
| 6 | `labor_split_incomplete` | warning | `estimate_quality` | split atelier/chantier partiel (`:53-57`) | oui |
| 7 | `price_outlier` | warning | `estimate_quality` | prix statistiquement atypique (`:58-62`) | oui |
| 8 | `quantity_outlier` | warning | `estimate_quality` | quantité atypique (`:63-67`) | oui |
| 9 | `margin_not_configured` | blocking | `estimate_quality` | `margin_mode = 'tiered'` sans tranche (`gating.ts:506-508`) | oui |
| 10 | `total_exceeds_budget` | blocking | `estimate_quality` | `total_ht_cents >` plafond (`gating.ts:510-517`) | oui |
| 11 | `no_pdf_generated` | blocking | `pdf` | aucun `estimate_documents` (`gating.ts:519-521`) | oui |
| 12 | `version_zero_review_pending` | blocking | `estimate_quality` | brouillon V0 IA actif (`gating.ts:523-525`) | oui |
| 13 | `rule_violation` | blocking | `approvals` | violations du moteur de règles (`gating.ts:641-700`) | **non** |
| 14 | `critical_missing_pieces` | blocking | `documents` | pièces critiques ouvertes (`gating.ts:721-733`) | **non** |
| 15 | `critical_open_questions` | blocking | `register` | hypothèses critiques ouvertes (`gating.ts:734-745`) | **non** |
| 16 | `client_missing_documents_required` | blocking | `documents` | pièces `clarify_with_client` (`gating.ts:746-758`) | **non** |
| 17 | `client_clarification_required` | blocking | `register` | hypothèses `clarify_with_client` (`gating.ts:759-770`) | **non** |
| 18 | `missing_pieces_pending` | warning | `documents` | pièces non critiques ouvertes (`gating.ts:771-783`) | **non** |
| 19 | `open_questions_pending` | warning | `register` | hypothèses non critiques ouvertes (`gating.ts:784-795`) | **non** |

**11 bloquants et 8 avertissements par défaut.** `canSend = blockingFlags.length === 0` (`gating.ts:798`).

### 4.1 La surcharge par tenant ne couvre que 12 drapeaux sur 19

Deux feature flags — `ESTIMATE_GATING_BLOCKING_FLAGS` et `ESTIMATE_GATING_WARNING_FLAGS` (`gating.ts:39-40`) — portent une liste CSV de clés (séparateurs `, ; \n` et espace, `gating.ts:186-204`) ; le flag doit être `enabled = true` pour que sa valeur soit lue (`feature-flags.ts:306-311`), et le blocage l'emporte sur l'avertissement en cas de double présence (`gating.ts:213-227`).

Mais `severityByFlag` n'est consulté que dans la boucle `gating.ts:554-600`, qui **saute explicitement `rule_violation`** (`:555-557`) et ignore tout drapeau dont l'ensemble d'items est vide (`:562`). Les six drapeaux du registre affaire ne peuplent jamais `itemIdsByFlag` (`buildItemIdsByFlag` ne lit que les drapeaux qualité, `:348-367`) : ils sont poussés séparément par `pushRegisterGatingFlag` avec une **sévérité passée en dur** au site d'appel (`:725`, `:737`, `:750`, `:763`, `:775`, `:787`). `rule_violation` est de même poussé avec `severity: "blocking"` (`:645`) ou `"warning"` (`:658`) en dur, la sévérité des signaux indisponibles découlant de l'action de la règle (`:667-672`).

> **Règle de gouvernance invisible :** un tenant qui inscrit `critical_missing_pieces` dans `ESTIMATE_GATING_WARNING_FLAGS` n'obtient aucun effet. Sept drapeaux sur dix-neuf ignorent silencieusement la configuration.

### 4.2 Plafond budgétaire

Il n'existe pas de colonne de budget. `parseProjectBudgetCeilingHtCents` (`gating.ts:243-283`) lit le champ libre `estimate_projects.notes`, tente un `JSON.parse`, cherche successivement `budget_ht_cents`, `budget_ceiling_ht_cents`, `total_budget_ht_cents` (`:254-258`), et à défaut applique la regex `/(?:budget_ht_cents|budget_ceiling_ht_cents)\s*[:=]\s*(\d+)/i` (`:275-277`). Aucune interface ne documente cette convention.

### 4.3 Forçage d'envoi

Sur la transition `draft → sent` uniquement (`server.ts:8385-8386`) : `force: true` est refusé aux non-admins (`FORCE_SEND_FORBIDDEN`, `server.ts:8392-8399`) ; sans `force`, la présence d'un bloquant lève `ESTIMATE_GATING_BLOCKED` avec le détail du gating (`server.ts:8401-8409`) ; avec `force`, l'événement de statut porte `forced_by_admin: true` et la liste des clés forcées (`server.ts:8411-8415`, `:8438-8441`).

### 4.4 Checklist d'édition (surface distincte)

`computeEstimateChecklist` (`checklist.ts:160`) est une jauge de complétude indépendante du gating : 5 critères (`checklist.ts:9-15`) — `prices` (blocking), `quantities` (blocking), `labor_roles` (warning), `margin_defined` (blocking), `validity_dates` (warning), définis en `:67-103`. `margin_defined` teste `margin_multiplier > 0`, ou la présence de tranches en mode `tiered` (`:121-127`). Un devis sans aucune ligne n'est jamais complet (`:175`).

---

## 5. Cycle d'approbation

### 5.1 Rôles

| Action | Contrôle applicatif | Contrôle base |
|---|---|---|
| Préparer une demande | `admin` ou `engineer` **et** propriétaire (ou `admin`) — `rules-engine.ts:3201-3206` | — |
| `submit_for_review` / `request` | `assertRequesterRole` = `admin`/`engineer` + propriétaire (ou `admin`) | RPC actor-scoped `open_estimate_review_cycle` ; les inserts directs de cycles et d'approbations sont révoqués |
| `decide` / `approve` / `reject` | `assertApproverRole` = `admin`/`director` | RPC de décision : rôle `admin`/`director`, cycle et révision actifs ; les updates directs sont révoqués |
| Traiter un item de correction | propriétaire du chiffrage strictement (`:3669-3671`) | RPC `record_estimate_review_correction_action` (`v3_020:754-770`) |
| Marquer un état relecteur | `admin`/`director` (`approvals/server.ts:220-222`) | RLS (`v3_019:32-88`) |

`getVersionAccessOrThrow` du moteur de règles élargit la visibilité aux approbateurs (`canAccessApprovalResource`, `:925-933`), là où celui de `server.ts` la restreint au propriétaire ou à l'`admin` (`canAccessOwnerResource`, `:915-923`).

### 5.2 Cycles de revue et relecteurs

Table `estimate_review_cycles` —
`20260306173000_v3_016_review_cycles_and_comments.sql`. Un index unique
partiel garantit un seul cycle actif par version et `cycle_number` reste unique
par version. La soumission ne construit plus ce cycle par une suite d'écritures
applicatives : `open_estimate_review_cycle`, définie par la migration
`20260812032857_govern_estimate_calc_engine_v2.sql`, verrouille la version, les
cycles et les approbations concernés, puis crée dans une seule transaction le
cycle, ses approbations et l'événement `approval_submitted`.

Un rejeu strictement identique sur la même révision renvoie le cycle existant
avec `created: false`. Si le contenu, le demandeur, le relecteur, le message ou
les règles ne correspondent plus, la RPC marque atomiquement l'ancien cycle et
toutes les approbations `pending` encore actives comme `superseded`, puis ouvre
le cycle suivant. `carried_over_from_cycle_id` conserve la filiation d'audit ;
la file et les mutations actives excluent les lignes remplacées.

`listAvailableEstimateApprovalReviewers` (`:2185-2237`) liste les membres `admin` ou `director` du tenant, via le **client service-role si disponible** (`:2189`), triés par nom. Si la liste est vide, un blocant `reviewer:none` est ajouté (`:3207-3214`) — c'est le seul signal de préparation sans `category` renseignée. Le relecteur assigné par défaut est le premier de la liste (`resolveAssignedReviewerOrThrow`, `:4252-4256`) ; un relecteur hors liste est refusé (`:4258-4263`).

### 5.3 Soumission

`submitEstimateApproval` action `submit_for_review` :

1. Fige d'abord le snapshot d'un brouillon v2 si nécessaire, puis recharge la
   version afin que le cycle capture la révision produite par le gel.
2. Évalue le résumé, la préparation et le relecteur ; tout blocant de
   préparation arrête la soumission.
3. Après `changes_requested`, refuse la resoumission tant qu'un item de
   correction reste `pending`, puis reporte les règles du cycle rejeté.
4. Soumet les règles `missing` ou `rejected`, complétées des règles reportées ;
   une liste vide est refusée.
5. Appelle `openEstimateReviewCycle`, façade service-role actor-scoped de la RPC
   atomique `open_estimate_review_cycle`.
6. N'envoie la notification au relecteur que si la RPC a réellement créé le
   cycle. L'échec Resend est journalisé mais ne défait pas la transaction métier.

### 5.4 Décision

`decide` (`:4616-4693`) exige un cycle ouvert (`:4624-4630`) et au moins une approbation `pending` (`:4633-4639`). Les commentaires sont normalisés contre les cibles autorisées (`normalizeDecisionComments`, `:3853-3897`) : cible inconnue ⇒ `badRequest` (`:3876-3878`) ; un `changes_requested` ou un `approved_with_reservations` **sans commentaire** est refusé (`:3887-3894`). Portées de commentaire (`estimate_review_comment_scope`) : `project`, `lot`, `line`, `approval_rule` à l'origine (`v3_016:29-38`), étendues à `exception` et `hypothesis` par `v3_020:44-69` ; les cibles sont construites depuis les lignes numérotées, les alertes de risque actives et les hypothèses actives (`buildEstimateReviewCommentTargets`, `:2496-2574`).

La décision est atomique via la définition de `decide_estimate_review_cycle`
livrée par `20260812032857_govern_estimate_calc_engine_v2.sql` :

- la RPC exige un acteur authentifié `admin` ou `director`, verrouille le devis
  et le cycle actif, puis refuse un cycle décidé, remplacé ou lié à une
  `content_revision` périmée ;
- `approved_with_reservations` et `changes_requested` exigent au moins un
  commentaire ;
- elle insère les commentaires, décide les approbations actives, ferme le cycle
  et journalise `approval_decided` dans une seule transaction ;
- pour `changes_requested`, la même instruction SQL crée exactement un item de
  correction `pending` par commentaire. La resoumission reste bloquée jusqu'au
  traitement de tous ces items ;
- pour `approved` et `approved_with_reservations`, chaque approbation décidée
  capture la `content_revision` courante dans `approved_content_revision`.

Les droits `INSERT` directs de `authenticated` et `anon` sont révoqués sur
`estimate_review_comments` et `estimate_review_correction_items`. La création
de ces lignes passe donc par la transaction de décision ; leur cohérence avec
un cycle actif est en plus protégée par trigger.

La décision règle par règle garde la même clôture sur révision fraîche, mais ne
peut pas fermer un cycle en `changes_requested` sans le commentaire et la
checklist obligatoires : elle lève alors
`ESTIMATE_REVIEW_CORRECTION_COMMENTS_REQUIRED`.

### 5.5 Invalidation des approbations à l'édition

`estimate_versions.content_revision` (`bigint not null default 1`, `20260713132620…:4-5`) est incrémenté par le trigger `aaa_guard_estimate_version_workflow_columns` (`:40-95`) dès qu'une des 22 colonnes contractuelles change (`:66-90`), et par `bump_estimate_content_revision_from_item` sur toute écriture de ligne (`:106-172`). Le trigger interdit toute modification directe de la colonne (`ESTIMATE_CONTENT_REVISION_IS_MANAGED`, `:58-64`) et réserve les changements de `status`/`seal_hash` au rôle `service_role` (`ESTIMATE_STATUS_REQUIRES_TRUSTED_WORKFLOW`, `:46-55`).

Le cycle capture la révision à son ouverture, valeur immuable ensuite. Côté
application, dès qu'une approbation active est `approved`, le moteur charge la
révision courante. Elle n'est fraîche que si
`approved_content_revision === currentContentRevision` ; sinon son
`approval_status` redevient `missing` sur le résumé, la préparation de
soumission et le gating d'envoi.

`preserveApprovedRequiresApproval: true` conserve une approbation **fraîche**
dans la représentation détaillée du résumé ; il ne court-circuite plus le
contrôle de révision et ne transforme jamais une approbation périmée en accord
valide.

### 5.6 Projection `approval_status`

Enum `estimate_version_approval_status` : `not_required`, `required`, `in_review`, `approved`, `changes_requested` (`v3_015:13-19`). Calcul — `rules-engine.ts:1597-1618` : aucune raison ⇒ `not_required` ; une raison `rejected` ⇒ `changes_requested` ; toutes `approved` ⇒ `approved` ; une `pending` ⇒ `in_review` ; sinon `required`.

`syncEstimateApprovalSummary` (`:3501-3644`) projette le résumé dans `approval_status` / `approval_summary` / `approval_evaluated_at` **via le client service-role** (`:3588-3600`) et journalise `approval_rules_evaluated`, plus `approval_status_changed` si le statut change (`:3605-3634`). L'écriture n'a lieu que si le résumé sérialisé diffère (`:3552-3557`) ; hors production, l'absence de clé service-role dégrade silencieusement (`:3571-3586`).

> **`getEstimateApprovalSummary` — donc un simple `GET /api/estimates/[versionId]/approval` — écrit en base et émet des événements** (`:3646-3658`, `trigger: "read"`). La lecture n'est pas neutre.

---

## 6. Journal de décision

`listEstimateApprovalDecisionJournal` (`:3016-3091`) lit `estimate_version_events` filtré sur `event_type = 'approval_decided'`, trié par `occurred_at desc` (`:3024-3033`), avec filtres facultatifs par auteur (`created_by`) et par décision (`metadata->>decision`, `:3034-3040`). La table est append-only et le type d'événement est contraint par un `check` (`v3_015:106-122`) ; la RPC d'écriture `log_estimate_version_event` est `security definer` et refuse un acteur étranger au tenant (`v3_015:124-223`, `:182-200`).

Décisions normalisées : `approved`, `approved_with_reservations`, `changes_requested` (`approval-decision-journal.ts:14-18`) ; une valeur héritée `rejected` est remappée en `changes_requested` (`:102-104`) et l'issue technique est dérivée par `resolveApprovalDecisionOutcome` (`:109-115`). Le libellé de périmètre vient de `metadata.perimeterLabel`, sinon est reconstruit : une portée ⇒ son libellé, plusieurs ⇒ `« <premier> + N autres »`, aucune ⇒ `« Affaire complete »` (`rules-engine.ts:2263-2284`).

Export CSV — `buildEstimateApprovalDecisionJournalCsv` (`:2968-3014`) : séparateur `;`, 10 colonnes, préfixe `'` devant toute cellule commençant par `= + - @` (protection anti-injection de formule, `:2941`). La route `GET …/approval-journal?format=csv` renvoie le fichier en pièce jointe (`approval-journal/route.ts:48-57`).

> La colonne `regles_declenchees` est vide pour toute décision prise via un
> cycle de revue : la définition Lot 7 de `decide_estimate_review_cycle` écrit
> toujours `'rulesTriggered', '[]'::jsonb`. Seule la voie règle par règle la
> remplit avec une entrée synthétique.

---

## 7. File d'approbation

RPC `list_approval_queue(p_sort_by)`, introduite par `v3_019` puis redéfinie
par `20260812032857_govern_estimate_calc_engine_v2.sql`, `security definer` et
refusée hors `admin`/`director`. Elle agrège uniquement les cycles non décidés
et non `superseded`, le nombre de commentaires, l'état relecteur courant, les
alertes de risque actives et le dernier job takeoff. Sa colonne `margin_bp`
expose la valeur historique pour v1 et la marge dérivée du coefficient figé
pour v2 ; une v2 sans coefficient autoritatif renvoie `null`. Les tris restent
`priority`, `amount`, `margin`, `age` ; `priority` est le défaut applicatif.

États relecteur — `approval_queue_reviewer_states.state check in ('seen','review_laurent','blocking','acceptable')` (`v3_019:14-15`), unicité par `(tenant, cycle, reviewer)` (`:18-19`) :

| Valeur stockée | Libellé affiché (`ApprovalQueueStateActions.tsx:8-13`) |
|---|---|
| `seen` | « Vu » |
| `review_laurent` | « A revoir » |
| `blocking` | « Bloquant » |
| `acceptable` | « Acceptable » |

> `review_laurent` fige un prénom dans une contrainte `check` de la base et dans les types TypeScript (`approvals/server.ts:41`, `direction/server.ts:59-63`). Le libellé neutre n'existe qu'en surface.

État visuel dérivé : `commented` si un commentaire existe, sinon `seen` si un état relecteur existe, sinon `new` (`approvals/server.ts:111-118`). Les causes de risque sont regroupées en 5 familles — `price`, `quantities`, `vat_conformity`, `missing_proofs`, `missing_documents` (`:18-33`). Chaque ligne de la file déclenche un appel supplémentaire `fetchDirectionProjectSignals`, avec absorption silencieuse des erreurs (`:189-201`).

---

## 8. Vue direction

Accès : `assertDirectionAccess` = `admin`/`director` (`direction/server.ts:238-248`), doublé par un `notFound()` dans la route (`direction/page.tsx:43-45`). Le portefeuille retient **une seule version par projet** — la première rencontrée après tri `project_id, version_number desc, updated_at desc` (`:483-500`) — en excluant les versions `archived` et les projets archivés (`:493-494`). Pagination de **24 cartes** (`:170`), requêtes découpées en lots de **100** (`:171`).

### 8.1 Alertes synthétiques

`buildDirectionSyntheticAlerts` (`alerts.ts:196-332`) ne produit rien s'il n'existe aucune alerte de risque (`:200-202`). Seuils codés en dur (`:45-47`) :

| Constante | Valeur | Groupe déclenché |
|---|---|---|
| `LOW_MARGIN_THRESHOLD_BP` | `1 200` (12 %) | `margin-fragile` (`:217`, `:223-242`) |
| `HIGH_VALUE_THRESHOLD_CENTS` | `2 500 000` (25 000 €) | `high-value-missing-proof` (`:218`, `:244-260`) |
| `STRONG_DISCOUNT_THRESHOLD_BP` | `800` (8 %) | `discount-awaiting-approval` (`:219-220`, `:262-280`) |
| horizon d'échéance | `7` jours | `deadline-incomplete` (`:221`, `:282-309`) |

Chaque groupe conserve au plus 3 motifs (`:175`) ; un groupe `generic` sert de repli si aucun autre ne s'applique (`:311-327`).

### 8.2 Score de priorité et états de file

`scoreWeeklyPriority` (`:304-337`) part du score de risque et ajoute : `+40` si échéance ≤ 7 j, `+20` si ≤ 30 j (`:312-314`) ; `+20` si montant ≥ 25 000 €, `+10` si ≥ 10 000 € (`:318-321`) ; `+15` si `required`/`in_review` (`:324-326`) ; `+25` si `changes_requested` (`:328-330`) ; `+20` si l'état relecteur est `blocking` (`:332-334`).

`deriveWeeklyQueueState` (`:339-363`) : `high_risk` si score ≥ 70 ou alerte critique ; sinon `blocked` si `changes_requested`, ou couverture `null` ou `< 65 %`, ou hypothèses ouvertes ; sinon `ready_not_validated` si `required`/`in_review` ; sinon `sendable`. Libellés « Risque eleve », « Bloqué », « Pret mais non valide », « Envoyable » (`WeeklySendPriorityQueue.tsx:22-25`).

### 8.3 Échéance, couverture, réassignation

`deriveSendTargetAt` (`:272-286`) retombe sur `updated_at + 7 jours` en l'absence de date. La vue direction appelle systématiquement `deriveSendTargetAt(null, version.updated_at)` (`:1064`) : le filtre d'horizon (`all`, `this_week` ≤ 7 j, `this_month` ≤ 31 j — `schemas.ts:1-5`, `server.ts:365-382`) porte donc sur une date **synthétique**, jamais sur une échéance réelle. Seul `fetchDirectionProjectSignals` extrait la vraie échéance des documents d'intake (`:975-979`).

`coveragePercent` = liens DPGF du dernier job / nombre total de lignes de la version, plafonné à 100 (`:918-925`) ; `exceptionCount` = décisions de revue DPGF du job (`:926`). Un échec de ce calcul est absorbé et renvoie une map vide (`:1037-1046`).

`assignDirectionProjectOwner` (`:1228-1244`) écrit directement `estimate_projects.user_id` : la réassignation d'un dossier **transfère la propriété**, donc les droits d'écriture, sans confirmation ni journalisation applicative. `updateDirectionAlertStatus` (`:1246-1263`) délègue à `updateTakeoffRiskAlertStatus`, alerte par alerte, en parallèle.

Un journal de débogage est écrit en clair dans `.next/dev/logs/direction-debug.log` et sur la sortie standard à chaque rendu (`direction/debug.ts:4-25`, appelé `server.ts:961`, `:1017`, `:1033`, `:1042`, `:1197`) ; il contient `tenant_id`, rôle et volumétrie. La route ajoute un `console.log` du tenant et du rôle à chaque requête (`direction/page.tsx:25-27,40-42`).

---

## 9. Barre de commande cockpit

`computeCockpitSuggestions` (`suggestions.ts:204-568`) produit au plus 10 intentions (`CockpitIntent`, `:17-27`) et 4 surfaces (`CockpitSurfaceId`, `:29-33`). Priorités codées en dur :

| Priorité | `actionId` | Condition principale |
|---|---|---|
| 900 | `add-files` | des documents existent déjà (`:233-246`) |
| 850 | `review-intake` | documents à revoir > 0 (`:248-265`) |
| 800 | `add-missing-pieces` | pièces manquantes détectées (`:267-280`) |
| 750 | `confirm-brief` | brief `a_confirmer` (`:282-300`) |
| 735 / 625 | `review-revalidation` | revalidation requise, critique ou non (`:441-477`) |
| 720 / 610 | `list-clarifications` | clarifications client ouvertes (`:479-508`) |
| 700 | `list-hypotheses` | entrées de registre ouvertes (`:510-544`) |
| 650 | `generate-structure` | V0 IA disponible ou structure préliminaire (`:333-391`) |
| 645 | `continue-hybrid` | import DPGF possible dans la structure courante (`:302-331`) |
| 500 | `analyze-plans` | jeux de plans présents et analyse relançable (`:393-413`) |
| 450 | `view-exceptions` | exceptions sur le dernier job (`:415-439`) |
| 400 | `prepare-validation` | `canPrepareRequest` **et** au moins une ligne (`:546-562`) |

Tri : épinglées d'abord, puis priorité décroissante, puis libellé (`byPriority`, `:83-91`). `isReadOnlyReview` neutralise toutes les suggestions d'écriture, `view-exceptions` restant seule accessible (`:415-439`). Seules `confirm-brief` et `prepare-validation` exigent une confirmation (`:296`, `:557`).

Préférences par utilisateur et par affaire (`cockpit_command_preferences`, clé de conflit `tenant_id,user_id,project_id,action_id` — `preferences.ts:123-136`), appliquées après coup (`applyCockpitSuggestionPreferences`, `:180-202`) ; l'absence de la table est traitée comme un jeu vide (`preferences.ts:71-78,96-101`). L'historique d'exécution est écrit dans `cockpit_command_history` sans valeur de retour ni gestion d'erreur (`history.ts:43-59`). L'affichage retient **3 suggestions visibles**, le reste passe en débordement (`useCockpitCommandBar.ts:7,17-18`).

---

## 10. Analytics

`fetchChiffreurAnalytics` (`analytics/server.ts:285-330`) : un non-`admin` qui demande un autre `ownerUserId` reçoit un `forbidden` (`:298-300`), sinon sa portée est forcée sur lui-même (`:302-304`). Horizons fixes — tendance sur **6 mois**, top affaires **10 lignes** (`:317-318`) ; la liste des chiffreurs n'est chargée que pour un `admin` (`:319`).

| RPC | Sortie | Sécurité |
|---|---|---|
| `get_chiffreur_analytics_kpis` | 6 KPI (`20260306_ux2_020_analytics.sql:19-27`) | `security invoker`, refus si `p_tenant_id <> current_tenant_id()` (`:39-41`), refus de portée croisée pour non-admin (`:50-53`) |
| `list_chiffreur_analytics_trend` | points mensuels (`:168-176`) | `grant execute … to authenticated` (`:290`) |
| `list_chiffreur_analytics_owners` | chiffreurs + volume (`:295-300`) | `grant execute … to authenticated` (`:357`) |
| `list_affaires_page` | top affaires (`analytics/server.ts:217-226`) | réutilisée telle quelle |

`acceptance_rate = accepted / (accepted + sent) × 100`, arrondi à 1 décimale, `0` si dénominateur nul (`:143-152`). `avg_days_to_first_acceptance` mesure l'écart entre la **création du projet** et le premier événement `accepted`, avec repli sur `updated_at` de la version si l'événement manque (`:104-126`), la valeur étant bornée à zéro par `greatest(…, 0)` (`:130-133`).

> La route `analytics/page.tsx` n'applique **aucun contrôle de rôle** : seule la navigation la réserve à `admin` et à `engineer` en mode expert (`build-nav-groups.tsx:295-299`, `dashboard-shortcuts.ts:42-47`). Un `viewer` ou un `director` qui atteint l'URL directement obtient les KPI de son propre périmètre.

---

## 11. Règles de gouvernance invisibles — récapitulatif

1. **Sept drapeaux de gating sur dix-neuf ignorent la surcharge par tenant**,
   sans aucun signal (§4.1).
2. **Le plafond budgétaire se configure dans un champ de notes en texte libre**
   (§4.2).
3. **La lecture du résumé d'approbation écrit en base** et émet des événements.
4. **`rulesTriggered` du journal de décision reste vide** pour une décision par
   cycle, même si les `ruleIds`, portées et commentaires sont journalisés (§6).
5. **Réassigner un dossier depuis la vue direction transfère la propriété** et
   donc les droits d'écriture (§8.3).
6. **L'échec d'envoi de l'e-mail au relecteur est silencieux** : le cycle est
   ouvert, personne n'est prévenu.
7. **`review_laurent`** — un prénom figé dans une contrainte de base et dans les
   types (§7).
