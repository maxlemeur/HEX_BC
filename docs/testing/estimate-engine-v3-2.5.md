# Persistance, gel et règles v3, derrière la politique (sous-lot 2.5)

Statut : **rouge écrit et observé ; M4 implémentée, pgTAP vert (§7)** (17/10/2026, commits `bd194ba7` et `40adfc74`,
`test(lot2-2.5)` ; preuve au §4). Ce document et
`supabase/tests/database/estimate-engine-v3-persistence.test.sql` sont rédigés avant tout code de
production et avant la migration M4. Le parcours E2E `V3P01` et l'isolation Vitest `R-01` à `R-05`
sont décrits dans [estimate-engine-v3-2.5-e2e.md](estimate-engine-v3-2.5-e2e.md) ; ce document-ci
est le document du sous-lot et renvoie à ceux-là. Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §0, §2,
D2 à D9, D12, D14, D15, D17, D18, §4, §5, §6.1 (M4), §6.2 à §6.5, §7, §8, §10, §14 « 2.5 ». Là où
ce document résume la conception, la conception fait foi ; là où il **choisit** (signalé « Choix »),
il fixe le contrat que le rouge exige.

Branche `lot2/2.5-persistance-v3`, base `e175f9eb` (moteur TS de 2.4, sans M3). M3
(`20261017134443_estimate_engine_v3_functions_and_units.sql`, branche `lot2/2.4-sql-units`) crée
déjà `public.estimate_line_pricing_status`, `public.measurement_units` et les fonctions pures
`private.estimate_v3_*` : M4 les suppose et sera horodatée après M3.

## 1. Contrat M4 que l'implémentation doit satisfaire

### 1.1 Politique d'entreprise (D3, §6.3, P-13)

| Objet | Contrat |
|---|---|
| `public.tenant_calc_policies` | §6.3 tel quel : `tenant_id` (clé primaire), `new_estimate_calc_engine smallint` ∈ {2,3}, `default_sale_coefficient_fo/mo numeric(8,4)` ∈ ]0 ; 10], `allowed_tax_rates_bp integer[]` (défaut `{2000,1000,550,210}`), `change_reason text` (5 à 500 caractères), `updated_by uuid`, `updated_at timestamptz` ; CHECK nommé `tenant_calc_policies_v3_requires_defaults` |
| `public.tenant_calc_policy_events` | **Choix** : `id`, `tenant_id`, `previous_policy jsonb` (nul à la première écriture), `new_policy jsonb` (`to_jsonb` de la ligne écrite, clé `new_estimate_calc_engine` comprise), `change_reason text`, `changed_by uuid`, `created_at timestamptz` |
| RLS | les deux tables : RLS active ; `select` pour les membres de l'entreprise (y compris le journal : **choix**) ; aucun `insert`/`update`/`delete` pour `authenticated` ni `anon`, aucun `select` pour `anon` (erreur `42501 permission denied for table …`) ; `service_role` garde ses quatre droits (`security-invariants.test.sql`) |
| `public.set_tenant_calc_policy(p_tenant_id uuid, p_new_estimate_calc_engine smallint, p_default_sale_coefficient_fo numeric, p_default_sale_coefficient_mo numeric, p_allowed_tax_rates_bp integer[], p_change_reason text, p_actor_user_id uuid)` | **Choix** de signature (noms des paramètres compris : la suite et le parcours l'appellent par arguments nommés). `security definer`, `search_path` fixé, exécutable par `service_role` **seul** (`42501 permission denied for function set_tenant_calc_policy` pour `authenticated` et `anon`). Motif nul ou de moins de 5 caractères : `22023 TENANT_CALC_POLICY_REASON_REQUIRED`. Passage à 3 sans les deux coefficients : `22023 TENANT_CALC_POLICY_V3_DEFAULTS_REQUIRED`. Écrit la ligne et un événement par appel |

### 1.2 Colonnes, contraintes et déclencheurs (D4 à D9, §6.2, §6.4)

- `estimate_versions` : `sale_coefficient_fo`, `sale_coefficient_mo` `numeric(8,4)` ; `gross_ht_cents`,
  `discount_applied_cents`, `commercial_rounding_cents` `integer`. Toutes nulles par défaut (D17).
- `estimate_items` : `unit_code text` (clé étrangère vers `measurement_units(code)`), `pricing_status
  estimate_line_pricing_status not null default 'priced'`, `h_mo_per_unit`, `h_mo_atelier_per_unit`,
  `h_mo_chantier_per_unit` `numeric(12,4)`, `snapshot_gross_ht_cents`, `snapshot_gross_fo_ht_cents`
  `integer`.
- CHECK `estimate_versions_engine_v3_shape_check` du §6.2, **avec `is not null` explicite** sur les cinq
  colonnes v3 dans la branche v3. Écart assumé : la forme du §6.2 vaut NULL (donc passe) quand un
  coefficient ou un montant v3 est nul ; la suite exige le refus (coefficient nul, `gross_ht_cents` nul,
  `commercial_rounding_cents` nul). En v1/v2, les cinq colonnes restent nulles (même CHECK).
- CHECK des sections (§6.2) : une section n'a ni unité, ni statut autre que `priced`, ni heures par
  unité (`23514`, nom libre ; le refus `ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED` du déclencheur est aussi admis).
- `guard_estimate_item_engine_columns` complété :
  - v1/v2 : `unit_code`, `h_mo*_per_unit` non nuls ou statut ≠ `priced` →
    `0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED` (**choix** du SQLSTATE, aligné sur le contrat d'écrivain) ;
    `snapshot_gross_*` sur une v1/v2 est refusé aussi, sans code imposé (garde de gel ou de moteur) ;
  - v3 : les sept colonnes de ligne entrent dans le contrat d'écrivain
    (`0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED` sans `miaouffrage.estimate_v3_writer`) ;
  - v3 : `tax_rate_bp` nul → taux de la version (l'écrivain l'omet en passant NULL ; le défaut de colonne
    2 000 ne doit pas s'appliquer) ;
  - v3 : `h_mo*` = `round(quantity × h/u, 3)` à l'insertion et à chaque changement de Q ou de h/u ;
    `h_mo > 0` sans `h_mo_per_unit`, ou `h_mo` modifié seul →
    `22023 ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED` (**choix** : un seul code pour les deux refus de D4).
- `guard_estimate_version_engine_v3_writer` : les cinq colonnes de version entrent dans le contrat.
- `guard_estimate_version_workflow_columns` : **chacune** des cinq colonnes incrémente
  `content_revision` (le gel devient périmé).
- `guard_estimate_v2_snapshot_columns` : `snapshot_gross_*`, `unit_code`, `pricing_status`, `h_mo*_per_unit`
  rejoignent les colonnes gérées (§6.4, point 5).

### 1.3 Création canonique (`persist_estimate_creation_atomic`, contrat `canonical_v3`)

- Signature inchangée. La clé `calc_engine_version` de la charge de version est **le moteur attendu**
  par le client (absente = 2, D3). La politique est lue `FOR SHARE` ; absente = 2. Écart →
  `40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED`, rien d'écrit (**choix** du nom : il contient
  `CONTEXT_CHANGED` sans se confondre avec `ESTIMATE_CREATE_CONTEXT_CHANGED`, conflit de verrou
  « réessayez » de `src/lib/estimates/errors.ts:193`).
- Liste blanche de version élargie à `sale_coefficient_fo`, `sale_coefficient_mo`, `gross_ht_cents`,
  `discount_applied_cents`, `commercial_rounding_cents`. Coefficients absents → défauts de la politique
  (**choix** : la création d'une v3 « sans coefficients » reçoit 1,30 / 1,20 ; des coefficients fournis
  sont repris, ce qu'exige EUHIST à c_FO 1).
- Lignes : clés `unit_code`, `pricing_status`, `h_mo_per_unit`, `h_mo_atelier_per_unit`,
  `h_mo_chantier_per_unit` ; `h_mo` n'est pas transmis (dérivé) ; `tax_rate_bp` peut l'être ou non.
- Après insertion, `private.estimate_v3_assert_draft(version)` (D12) : PU de ligne recalculé, 0 ≤ net ≤
  ⌈Q × PU⌋, `gross_ht_cents` = Σ bruts, remise et arrondi = f(intention, G), identités, Σ TVA de ligne
  par taux = ⌈base × r⌋. Écart → `22023 ESTIMATE_V3_PROJECTION_MISMATCH` (**choix** du SQLSTATE).
  Un taux hors politique ou une unité absente sont admis en brouillon.

### 1.4 Réglages (`save_estimate_settings_atomic`, branche v3)

Signature inchangée. Clés de réglage ajoutées : `sale_coefficient_fo`, `sale_coefficient_mo`,
`apply_tax_rate_to_lines` (D8). **Choix** : projections v3 = `id`, `pu_ht_cents`,
`line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents`, `tax_rate_bp` ; totaux = les quatre
clés actuelles plus `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents` ;
dépendances inchangées (`margin_tiers` toujours `[]` en v3). Aucune intention de remise n'est dérivée
de l'autre ; `estimate_v3_assert_draft` → `ESTIMATE_V3_PROJECTION_MISMATCH`.

### 1.5 Gel v3 (`public.freeze_estimate_v3_snapshot`, D12, D15)

- Signature de la jumelle v2 : `(uuid, uuid, timestamptz, bigint, uuid, text, jsonb, jsonb, jsonb)`,
  `service_role` seul ; `private.estimate_v3_compute(uuid)` et `private.estimate_v3_assert_draft(uuid)`
  révoquées pour tous sauf le propriétaire.
- Lignes figées (**choix** des clés) : `id`, `snapshot_pu_ht_cents`, `snapshot_gross_ht_cents`,
  `snapshot_gross_fo_ht_cents`, `snapshot_fo_ht_cents`, `snapshot_mo_ht_cents`,
  `snapshot_mo_atelier_ht_cents`, `snapshot_mo_chantier_ht_cents`, `line_total_ht_cents`,
  `line_tax_cents`, `line_total_ttc_cents`. Sans ventilation, toute la MO est « chantier » (convention
  v2 et de M3, imposée par `estimate_items_v2_snapshot_complete_check`).
- Totaux : `total_ht_cents`, `total_tax_cents`, `total_ttc_cents`, `rounding_adjustment_cents` (0),
  `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents`.
- Contexte §6.5 : `engine`, `labor_split_enabled`, `labor_roles` (**choix** : `[{id, hourly_rate_cents}]`
  par `id` croissant, comme le gel v2), `sale_coefficients`, `discount` {`kind` ∈ `none|amount|rate`,
  `requested_cents`, `rate_bp`, `base_cents`, `applied_cents`}, `commercial_rounding`,
  `cost_subtotal_cents`, `realized_sale_coefficient` (6 décimales), `tax_breakdown` ; ni `margin_tiers`
  ni `effective_margin_multiplier`.
- Recalcul complet, égalité au centime de chaque valeur (répartitions comprises) →
  `22023 ESTIMATE_V3_PROJECTION_MISMATCH` ; ligne chiffrée sans unité → `22023 ESTIMATE_V3_UNIT_REQUIRED` ;
  taux hors `allowed_tax_rates_bp` → `22023 ESTIMATE_V3_TAX_RATE_NOT_ALLOWED` (**choix** des deux noms).

### 1.6 File d'approbation, duplication, métré

- `list_approval_queue` : pour une v3 au gel frais avec `cost_subtotal_cents` numérique et HT > 0,
  `margin_bp` = ⌈(HT − Σ D) × 10 000 / HT⌋ (S1 : 2 054 ; T-MARG : **0**, pas NULL) ; sinon NULL. Le texte
  `version.calc_engine_version = 1` asserté par `estimate-calc-engine-governance.test.sql:1086` reste.
- `duplicate_estimate_version_without_product_id` : copie les colonnes v3 sous le contrat d'écrivain ; le
  moteur suit la source, quelle que soit la politique (I4, P-15).
- Métré : fonctions inchangées ; le contrat d'écrivain le refuse (`ESTIMATE_V3_WRITER_NOT_SUPPORTED`) ;
  le message TS `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED` reste en 2.8 (D16).

### 1.7 Ce que M4 doit aussi mettre à jour hors de cette suite

- **Garde F-SQL-14** (`estimate-calc-engine-v3-guards.test.sql`, liste blanche) : ajouter, si leur source
  compare un `*engine_version` à un littéral, `public.freeze_estimate_v3_snapshot`,
  `private.estimate_v3_compute`, `private.estimate_v3_assert_draft`,
  `public.duplicate_estimate_version_without_product_id`, `private.canonical_estimate_batch_operations`,
  `public.bulk_update_estimate_items`, `public.guard_estimate_version_workflow_columns` ; réécrire les
  motifs devenus faux de `persist_estimate_creation_atomic` (« jusqu'au contrat canonical_v3 »),
  `save_estimate_settings_atomic`, `commit_estimate_batch`, `atomic_create_estimate_item` (« le contrat
  d'écrivain refuse la v3 jusqu'à M4 »), `list_approval_queue` (« marque v3 en M4 »),
  `enforce_estimate_calc_engine_on_insert` (`canonical_v3` → 3).
- **Assertions de 2.1 devenues fausses par construction** (réécriture délibérée, comme 2.1 l'a fait pour
  la gouvernance) : F-SQL-02 « la RPC de création refuse un moteur 3 » (devient
  `ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` sans politique) ; F-SQL-10 réglages, lot et création atomique
  sur une v3 (branches v3 désormais) ; F-SQL-11 duplication d'une v3 (désormais admise).
- **Fixtures v3 existantes** qui violeraient le CHECK de forme ou D4 : la fixture de
  `estimate-calc-engine-v3-guards.test.sql` (v3 sans coefficients, lignes à `h_mo = 1` sans h/u),
  `pg_temp.governance_v3_fixture` de `estimate-calc-engine-governance.test.sql` (même cas) et
  `e2e/army/local/engine-v3-support.ts` (v3 à `margin_multiplier` 1,5, sans coefficients).
- **Montée de version** : déclarer dans `upgrade_check.declared_new_columns()`
  (`supabase/tests/upgrade/lot2-compare.sql`) les cinq colonnes de version (`null`), `unit_code`,
  `h_mo*_per_unit`, `snapshot_gross_*` (`null`) et `pricing_status` (`"priced"`).
- `src/types/database.ts` (CRLF) à la main (D18), `npm run supabase:manifest:add`, `supabase:validate`.
- **Hors M4 (choix)** : les colonnes v3 de `estimate_templates` et `estimate_template_items` (§6.2 les place
  en M4, §6.1 en M6). Le rouge ne les asserte pas ; elles suivent les chemins d'entrée (2.8, M6).

## 2. Défaillances observables et preuves

pgTAP : `supabase/tests/database/estimate-engine-v3-persistence.test.sql` (les libellés d'assertion
commencent par l'identifiant). E2E et Vitest : [estimate-engine-v3-2.5-e2e.md](estimate-engine-v3-2.5-e2e.md).

| Id | Défaillance observable | pgTAP | E2E / Vitest |
|---|---|---|---|
| F25-01 | Course politique ↔ création : une création décidée sous un moteur et persistée sous un autre ; un ancien bundle (sans attente) reçoit une v3 ; une attente 3 sans politique crée une v2 en silence | politique absente → v2 ; attente 3 sans politique, attente absente ou 2 sous politique 3 → `ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` ; huit v3 créées par la RPC canonique sous politique 3 | V3P-02 (409 `CONTEXT_CHANGED`, nombre de versions inchangé) |
| F25-02 | Colonnes absentes, mal typées ou sans clé d'unité (D18) | `has_table`, `col_type_is`, `col_not_null`, `col_is_pk`, `fk_ok` | V3P-01 (sonde du schéma) |
| F25-03 | Un administrateur d'entreprise (F10) ou `anon` change le moteur ; changement sans motif, sans coefficients, ou non tracé | privilèges `{t,f,f}` + `security definer` ; appels `authenticated`/`anon` refusés ; motif ; défauts requis (fonction et CHECK de table) ; ligne et événement | V3P-01, V3P-02 (politique par `service_role`) |
| F25-04 | Politique ou journal lisibles par une autre entreprise, écrits ou effacés directement | lecture propre à chaque entreprise ; `insert`/`update`/`delete` d'un administrateur et lecture `anon` refusés, sur les deux tables | — |
| F25-05 | v3 écrite sans coefficients, ou montants stockés faux ; intention de remise dérivée (S2 : `discount_bp` ≠ 0) | défauts 1,30 / 1,20 ; S1, S2, S3 au §5.2 (montant 101 avec `discount_bp` 0 ; taux 1 000 sans montant) | V3P-03, V3P-05, V3P-07 |
| F25-06 | Une v3 garde un palier, un multiplicateur ou coefficient global ≠ 1, une cascade, montant et taux ensemble, le mode `up`, un ajustement d'arrondi, une identité de total fausse, un coefficient ou montant v3 nul ; une v2 porte un coefficient | douze sondes sous contrat d'écrivain + v2 → `estimate_versions_engine_v3_shape_check` | V3P-03, V3P-11 |
| F25-07 | Dérive h/u ↔ `h_mo` : `h_mo` saisi sans h/u, modifié seul, non suivi de Q, mal arrondi ; colonnes v3 sur une v1/v2 ou une section ; colonnes v3 hors contrat d'écrivain | `h_mo` S1 (39,820 … 281,436) ; 10 × 0,5 ; 2,5 × 0,001 = 0,003 ; atelier/chantier ; refus D4 ; Q 20 → 10,000 ; h/u 0,75 → 7,500 ; quatre refus v1/v2 (h/u en mise à jour et à l'insertion, unité, statut) ; section ; quatre refus hors contrat | V3P-04 |
| F25-08 | Ligne v3 sans taux : défaut de colonne 2 000 au lieu du taux de version | version à 1 000 : ligne créée et ligne insérée à 1 000 | V3P-08 (application à toutes les lignes) |
| F25-09 | Projection décalée d'1 c acceptée à la sauvegarde | création : PU O1 16 664, net O1 > brut (erreur compensée), brut de version +1 (identité maintenue), TVA du groupe 20 % +1 (sommes cohérentes) ; réglages : PU EUHIST 401 | V3P-05 (positif) |
| F25-10 | Projection décalée d'1 c acceptée au gel ; gel v3 incomplet ou au contexte v2 | 1 c déplacé dans le groupe de TVA, entre FO et MO nets, dans le FO brut, entre deux parts de remise (S2) ; S1, S2, S3 exacts acceptés ; S1 frais, contexte v3, bruts et PU figés | V3P-09 |
| F25-11 | Gel d'une ligne chiffrée sans unité | `ESTIMATE_V3_UNIT_REQUIRED` | — |
| F25-12 | Gel avec un taux non autorisé (19,6 %) | `ESTIMATE_V3_TAX_RATE_NOT_ALLOWED` | — |
| F25-13 | Gel périmé qui paraît frais (nouvelle colonne hors de la liste de révision, R4) | chacune des cinq colonnes, seule (CHECK retiré dans la sonde annulée), incrémente `content_revision` et périme le gel | — |
| F25-14 | EUHIST : changer c_FO réécrit l'intention (taux → montant) ou n'applique pas la remise au nouveau brut | réglages c_FO 1 → 2 : 400 / 40 / 360 / 72 / 432, `discount_bp` 1 000, montant nul | V3P-07 |
| F25-15 | File d'approbation : marque v2 appliquée, 0 au lieu de NULL, NULL au lieu de 0, gel périmé lu comme frais | S1 2 054 ; T-MARG 0 ; S1 après changement de taux horaire → NULL | V3P-09 (carte « Marge 11.7 % ») |
| F25-16 | Métré appliqué à une v3 (P-19) | `apply_takeoff_job_guarded_atomic` → `ESTIMATE_V3_WRITER_NOT_SUPPORTED` | — (TS : 2.8) |
| F25-17 | Retour à la politique 2 : création encore v3, attente 3 acceptée, v3 existante modifiée, changement non tracé | v2 créée ; attente 3 refusée ; S1 intacte ; deuxième événement 3 → 2 | V3P-11, V3P-12 |
| F25-18 | Duplication qui change moteur ou montants | S2 dupliquée sous politique 2 : moteur 3, coefficients, intention, totaux et lignes identiques | V3P-10 |
| F25-19 | Montée de version : une ligne v1/v2 existante reçoit une valeur v3 | la v2 témoin n'a que des valeurs neutres ; preuve complète par `npm run db:upgrade-check` sur base peuplée (§10.2) | — |
| F25-20 | Règle `min_margin` calculée depuis 0 sur un brouillon v3 sans preuve ; T-MARG non violée | — | Vitest `R-01` à `R-05` (`src/lib/estimates/rules-engine.v3-margin.test.ts`) |

Concurrence réelle (deux sessions, politique changée entre lecture et insertion) : non reproductible en
pgTAP mono-session. La preuve repose sur le verrou `FOR SHARE` de la politique dans la création, lu par
revue, et sur sa conséquence observable assertée ci-dessus : toute création dont l'attente diffère de la
politique au moment de l'insertion échoue sans rien écrire.

## 3. Justification de l'isolation (pgTAP)

`AGENTS.md` place l'E2E en premier ; `V3P01` couvre le chemin nominal par l'API et l'écran. Ces
défaillances-ci y échappent, et chacune relève d'une exception admise (intégrité SQL, autorisation,
cas limites) :

- **Égalité au centime à la sauvegarde et au gel (F25-09, F25-10)** : l'application n'envoie que des
  projections justes ; seule une charge altérée d'un centime, impossible à produire par l'interface,
  prouve que le SQL refuse (D12). Les cas compensés (sommes justes, répartition fausse) sont invisibles
  à l'écran.
- **Autorisation (F25-03, F25-04)** : un administrateur d'entreprise qui écrit la politique, `anon`, une
  autre entreprise ; l'E2E ne dispose que du compte de recette et passe par `service_role`.
- **Intégrité des déclencheurs et du CHECK (F25-06, F25-07, F25-13)** : écritures directes sous contrat
  d'écrivain, colonne par colonne ; aucun écran ne permet d'écrire `h_mo` seul ou une seule colonne de
  montant.
- **Refus au gel (F25-11, F25-12) et métré (F25-16)** : l'éditeur v3 n'existe qu'en 2.6 ; l'E2E de 2.5 ne
  peut pas saisir une ligne sans unité ou à 19,6 %, ni lancer un métré sur une v3.
- **File d'approbation en NULL (F25-15)** : invalider un gel en cours de revue exige un changement de
  taux horaire qui toucherait les parcours concurrents de l'entreprise de recette.

## 4. Rouge observé (17/10/2026)

WSL Ubuntu 24.04, Node 24.14.0, clone `~/miaouffrage-lot2-25` au commit `40adfc74` (base `e175f9eb`
sans M3 ni M4), une exécution native possédée, mutex respecté. Seul écart local, temporaire et annulé
après l'exécution : la troncature des diagnostics du harnais (`slice(-6_000)` de
`src/test/local-supabase-ci.ts:647`) portée à 400 000 caractères pour garder la sortie pgTAP complète.
Journal (non versionné) : `.e2e/lot2-2.5/red/db-ci-local-full.log` du clone, SHA-256
`c127b9786fb88fcfb5681b6906dbafb80b9d9a56150eb50697ff45ac9ec1080c`.

`npm run db:ci:local` → sortie 1 : pile, `db reset` et inventaire des migrations passés ; pgTAP
`Files=16, Tests=1418`, `Result: FAIL`. Les 15 autres suites passent (garde F-SQL-14 de 2.1 comprise :
« aucune » entrée orpheline). La nouvelle suite va jusqu'au bout : 90 assertions, 87 rouges
(`Failed tests: 2-37, 40-90`), 3 vertes : l'intégrité de la fixture oracle (S1-S3 du §5.2) et, déjà
vrai avant M4, « politique absente → v2 » (fixture et assertion F25-01). Motifs des rouges :

| Motif obtenu | Assertions |
|---|---|
| Objet de M4 absent : `42P01` (`tenant_calc_policies`, `tenant_calc_policy_events`), `42703` (colonnes v3 de version et de ligne), `42883` (`set_tenant_calc_policy`, `freeze_estimate_v3_snapshot`), `42704` (`estimate_versions_engine_v3_shape_check`), `has_table`/`col_type_is`/`fk_ok` négatifs | F25-02 à F25-04, F25-06, F25-07, F25-10 à F25-13, F25-19 |
| Contrat `canonical_v3` absent : la création actuelle refuse le moteur 3 et les clés v3 (`22023 ESTIMATE_VERSION_PAYLOAD_INVALID`) au lieu de `ESTIMATE_CALC_POLICY_CONTEXT_CHANGED`, de créer la v3 ou de refuser la projection décalée | F25-01, F25-05, F25-09 (création) |
| Refus absent : sous « politique 3 », une attente 2 crée une v2 (`ok`) | F25-01 |
| Branche v3 des réglages absente : `22023 ESTIMATE_SETTINGS_INVALID_INPUT` (clé `sale_coefficient_fo` inconnue) | F25-14, F25-09 (réglages) |
| Conséquence de l'absence de v3 (aucune version créée) : mises à jour sans ligne (`ok`), `DRAFT_LOCK_VERSION_NOT_FOUND`, clé étrangère du métré, `TAKEOFF_APPLY_OPERATOR_REQUIRED`, `ESTIMATE_REVIEW_OPEN_FORBIDDEN`, version introuvable à la duplication, file sans ligne | F25-06 (8 sondes sur 12), F25-07 (2 sondes), F25-15, F25-16, F25-18 |

Premier passage sur `bd194ba7` (diagnostics tronqués par le harnais, `.e2e/lot2-2.5/red/db-ci-local.log`) :
mêmes comptes (16 fichiers, 1 418 assertions, 87/90). `40adfc74` corrige deux sondes avant le vert : le
refus d'un ajustement d'arrondi passe par le marqueur de réglages (`guard_estimate_rounding_adjustment`
le refuserait avant le CHECK), et `snapshot_gross_*` sur une v2 sort de la liste (deux gardes possibles,
ordre de déclencheurs non fixé).

## 5. Commandes

```bash
# WSL, clone Linux ~/miaouffrage-lot2-25 (au plus deux exécutions natives possédées en parallèle)
npm run db:ci:local
npm run e2e:army:local -- --grep "V3P01"
# Windows ou WSL
npx vitest run --project=node src/lib/estimates/rules-engine.v3-margin.test.ts
```

Au vert (implémentation) : la même suite sans modification d'assertion, après M3 et M4 ; suites 2.1 et
gouvernance réécrites selon le §1.7 ; `npm run db:upgrade-check -- lot2-2-5` à 0 différence ; corpus figé
et empreintes documentaires identiques ; `git diff --stat` vide sur `estimate-calculations.ts` et
`estimate-v2-snapshot.ts`.

## 6. Limites et points ouverts

- **Lignes non chiffrées** (`pricing_status` ≠ `priced`) : M3 ne leur donne pas de PU, mais
  `estimate_items_item_type_payload_check` exige `pu_ht_cents` non nul sur toute ligne, et le gel v2
  exige une ligne figée par ligne. Leur stockage et leur gel ne sont pas fixés par ce rouge (T-STAT reste
  couvert par 2.4) : décision à prendre à l'implémentation, puis assertion à ajouter.
- **Convention atelier/chantier** : sans ventilation, le moteur TS de 2.4 rend `[0, 0]`, M3 met toute la MO
  en « chantier ». Le gel impose la seconde (CHECK existant) : la projection TS doit s'y aligner, sinon la
  parité et le gel échouent.
- **Lot et création atomique** : les sauvegardes v3 par `commit_estimate_batch` et
  `atomic_create_estimate_item` ne sont couvertes ici qu'en positif par l'E2E ; leur refus d'un centime
  est à écrire en remplaçant les assertions F-SQL-10 de 2.1 (§1.7).
- pgTAP ne charge pas `safeupdate` : toute `UPDATE`/`DELETE` de M4 doit porter un `WHERE` ; seule l'E2E
  (session PostgREST) le prouve.
- Les sondes F25-13 retirent le CHECK de forme dans une sous-transaction annulée : elles supposent qu'aucun
  autre déclencheur ne vérifie l'identité des totaux de version.

## 7. Implémentation SQL (M4)

Migration `supabase/migrations/20261017162000_estimate_engine_v3_persistence.sql` (horodatage ramené dans la
tolérance de 10 min de `supabase:validate`, qui refusait `20261017174500`), manifeste à jour. Commits :
`db753d21` (`test`, sonde des lignes non chiffrées rouge d'abord, sondes booléennes corrigées), `40ac4c9f`
(`feat`, M4 et réécritures du §1.7), puis ce document. Chaque fonction redéfinie part de `pg_get_functiondef`
sur une pile native reconstruite à `20261017134443` ; seules les lignes v3 changent (`persist…` réécrite à
la main sur cette base, les cinq autres dérivées par remplacements exacts vérifiés un à un).

### 7.1 Interface SQL (piste TS et parcours `V3P01`)

| Objet | Contrat |
|---|---|
| `set_tenant_calc_policy(p_tenant_id uuid, p_new_estimate_calc_engine smallint, p_default_sale_coefficient_fo numeric, p_default_sale_coefficient_mo numeric, p_allowed_tax_rates_bp integer[], p_change_reason text, p_actor_user_id uuid) → tenant_calc_policies` | `security definer`, `service_role` seul. `p_allowed_tax_rates_bp` nul → `{2000,1000,550,210}`. Erreurs `22023` : `TENANT_CALC_POLICY_REASON_REQUIRED` (motif nul, < 5 ou > 500 caractères après `btrim`), `TENANT_CALC_POLICY_INVALID` (entreprise, auteur ou moteur nul ou inconnu, moteur ∉ {2,3}, coefficient ∉ ]0 ; 10] ou à plus de 4 décimales, liste de taux vide, nulle ou hors [0 ; 10 000]), `TENANT_CALC_POLICY_V3_DEFAULTS_REQUIRED`. Écrit la ligne et un événement (`previous_policy` nul à la première écriture) |
| `tenant_calc_policies`, `tenant_calc_policy_events` | Lecture par les membres (`is_tenant_member`) ; aucune écriture `authenticated`/`anon` |
| `persist_estimate_creation_atomic` (signature inchangée) | Version : `calc_engine_version` = moteur **attendu** ∈ {1,2,3}, absent = 2 (hors liste : `22023 ESTIMATE_VERSION_PAYLOAD_INVALID`) ; ≠ politique (absente = 2) : `40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED`, avant toute écriture. Clés v3 : `sale_coefficient_fo`, `sale_coefficient_mo` (facultatives, nombre ]0 ; 10] à 4 décimales au plus ; absentes ou nulles = défauts de la politique), `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents` (obligatoires en v3, entiers JSON ≥ 0). Sous politique 2, ces clés absentes ou nulles. Lignes : `unit_code` (code de `measurement_units`, sinon `23503`), `pricing_status` (défaut `priced`), `h_mo_per_unit`, `h_mo_atelier_per_unit`, `h_mo_chantier_per_unit` ; `tax_rate_bp` facultatif en v3 (taux de version) ; `h_mo*` non transmis (dérivés, écrasés s'ils le sont). Ligne non chiffrée : `pu_ht_cents` nul, net et TVA nuls. Puis D12 : `22023 ESTIMATE_V3_PROJECTION_MISMATCH` (le `detail` nomme le contrôle) |
| `commit_estimate_batch` (inchangée) | `data` des créations et mises à jour de ligne : les cinq clés de ligne v3 (`unit_code` texte ou nul, `pricing_status`, h/u nombre ≥ 0 à 4 décimales au plus ou nul). v3 : `p_version_patch` = exactement six clés (`total_ht_cents`, `total_tax_cents`, `total_ttc_cents`, `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents`) ; v1/v2 : les trois clés historiques seules (sinon `ESTIMATE_BATCH_INVALID_INPUT`). v3 : `p_item_updates` couvre **toutes** les lignes (comme la v2), `pu_ht_cents` nul admis. Écart D12 → `22023 ESTIMATE_BATCH_PROJECTION_MISMATCH` |
| `atomic_create_estimate_item` (inchangée) | `p_item` : les cinq clés v3. v3 : `p_version_patch` à six clés, même pour une section ; projections de toutes les lignes, `pu_ht_cents` nul admis ; forme fausse → `22023 ESTIMATE_CREATE_INVALID_INPUT` ; D12 → `22023 ESTIMATE_V3_PROJECTION_MISMATCH` |
| `save_estimate_settings_atomic` (inchangée) | Clés de réglage : `sale_coefficient_fo`, `sale_coefficient_mo` (nombre ]0 ; 10], 4 décimales au plus), `apply_tax_rate_to_lines` (booléen) ; sur une v1/v2 → `ESTIMATE_SETTINGS_INVALID_INPUT`. v3 : `p_totals` à sept clés (les quatre historiques + `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents`) ; projections `id`, `pu_ht_cents` (nul si non chiffrée), `line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents`, `tax_rate_bp` (= taux de version si `apply_tax_rate_to_lines`, sinon taux actuel de la ligne) ; forme non v3 (paliers, multiplicateur ou coefficient global ≠ 1, cascade, montant et taux, `up`/`nearest`) → `ESTIMATE_SETTINGS_INVALID_INPUT` avant écriture ; D12 → `22023 ESTIMATE_V3_PROJECTION_MISMATCH` ; dépendances inchangées (`margin_tiers` `[]`) |
| `duplicate_estimate_version(uuid, boolean)` (inchangée) | v3 → v3 (colonnes v3 comprises) quelle que soit la politique ; v1/v2 inchangées |
| `freeze_estimate_v3_snapshot(p_version_id, p_tenant_id, p_expected_updated_at, p_expected_content_revision, p_actor_user_id, p_purpose, p_calculation_context, p_item_snapshots, p_version_totals) → estimate_versions` | `service_role` seul ; `p_purpose` ∈ `send` (bail du demandeur exigé) / `approval` (aucun bail d'un tiers). Contexte **égal** à l'objet §6.5 : `engine` 3, `labor_split_enabled`, `labor_roles` `[{id, hourly_rate_cents}]` (rôles cités par toute ligne, non chiffrée comprise, taux du rôle du propriétaire ou 0, `id` croissant), `sale_coefficients {fo, mo}`, `discount {kind, requested_cents, rate_bp, base_cents, applied_cents}`, `commercial_rounding {mode, step_cents, applied_cents}`, `cost_subtotal_cents`, `realized_sale_coefficient` (6 décimales ou nul), `tax_breakdown` (taux croissants) — aucune autre clé. Lignes : un objet par ligne (aucune section), onze clés (`id` + les dix du §1.5 ; `snapshot_pu_ht_cents` nul sur une ligne non chiffrée). Totaux : sept clés (`rounding_adjustment_cents` 0). Écrit aussi `pu_ht_cents`. Idempotente si le gel identique est déjà frais. Erreurs : `42501 SERVICE_ROLE_REQUIRED`, `22023 ESTIMATE_V3_SNAPSHOT_PURPOSE_INVALID`, `42501 ESTIMATE_V3_SNAPSHOT_NOT_WRITABLE`, `40001 ESTIMATE_DRAFT_LOCK_REQUIRED` / `ESTIMATE_DRAFT_LOCK_CONFLICT` / `ESTIMATE_VERSION_CONFLICT`, `42501 ESTIMATE_V3_SNAPSHOT_REQUIRES_DRAFT`, `22023 ESTIMATE_V3_SNAPSHOT_INVALID` (types), `23503 ESTIMATE_LABOR_ROLE_OWNER_MISMATCH`, `23502 ESTIMATE_V3_LABOR_ROLE_REQUIRED`, `22023 ESTIMATE_V3_UNIT_REQUIRED`, `22023 ESTIMATE_V3_TAX_RATE_NOT_ALLOWED`, `40001 ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT`, `22023 ESTIMATE_V3_PROJECTION_MISMATCH`, et celles de M3 (`22023 ESTIMATE_V3_INPUT_INVALID`, `22003 ESTIMATE_AMOUNT_OVERFLOW`) |
| `list_approval_queue` | v3 : `margin_bp` = ⌊(2 (HT − Σ D) × 10 000 + HT) / (2 HT)⌋ (= `computeEstimateV3NetMarginBp`) sur un gel frais de contexte `engine` 3 avec `cost_subtotal_cents` numérique et HT > 0 ; sinon NULL |
| Lignes, écritures directes | v1/v2 : colonnes v3 non nulles ou statut ≠ `priced` → `0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`. v3 : sept colonnes sous contrat d'écrivain (`0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED`) ; `h_mo > 0` sans h/u, ou `h_mo*` modifié seul → `22023 ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED` |

Lecture canonique d'une v3 stockée (`private.estimate_v3_canonical_input`, à reproduire côté TS pour la
parité du gel) : lignes par `id` croissant ; `labor_rate_cents` = taux du rôle du propriétaire ou 0 ;
`labor_rate_atelier_cents` / `_chantier_` = taux du rôle ou nul ; `labor_split_enabled` = drapeau
`EST_031_LABOR_SPLIT` actif ; `reverse_charge` = `contractor_role = 'subcontractor'`.

### 7.2 Choix d'implémentation

1. **R-08** : les heures sont dérivées par `private.estimate_v3_line_values` (M3), dans le déclencheur
   `ab_derive_estimate_item_v3_columns` (`private.derive_estimate_item_v3_columns`, `security definer`) :
   une ligne non chiffrée à h/u renseigné stocke `0.000` ; `h_mo_atelier`/`h_mo_chantier` restent nuls si
   leur h/u l'est ; `h_mo`, que le CHECK de charge utile exige sur une ligne, vaut alors 0. Le déclencheur
   suit la garde d'écrivain (`aay_`) et la garde de gel héritée (`aaz_`) : le contrat d'écrivain et le refus
   `ESTIMATE_LABOR_ROLE_OWNER_MISMATCH` gardent leur priorité (sonde F-SQL-05 de 2.1 inchangée). Le taux de
   version par défaut et les refus de D4 y sont portés aussi.
2. **Autoliquidation** : `reverse_charge = (contractor_role = 'subcontractor')`, lu par le recalcul.
3. **Lignes non chiffrées** : `pu_ht_cents` nul ; seuls `estimate_items_item_type_payload_check` et
   `estimate_items_v2_snapshot_complete_check` sont détendus, par `pricing_status <> 'priced'`, que la garde
   réserve à la v3 ; toute ligne existante reste valide (montée de version : 0 différence). Au gel : PU figé
   nul, parts figées à 0 (le lecteur TS de 2.4 exige des entiers). Preuve : F25-21, F25-22 ci-dessous.
4. **CHECK de forme** avec `is not null` explicite sur les cinq colonnes v3.
5. **Modèles** : colonnes v3 en M6 (2.8), hors M4.
6. **v3 sous politique 2** : modifiable, gelable, duplicable ; la duplication d'une v2 reste une v2. Une v3
   se duplique par un contrat d'insertion distinct, `duplicate_source_v3` : `duplicate_source` ne produit
   toujours pas de v3 (assertion F-SQL-02 de 2.1 inchangée). L'article lié est copié pour une v3, ce qui rend
   neutre la mise à jour de `duplicate_estimate_version` (sinon refusée par le contrat d'écrivain).
7. **Métré** : refusé en SQL par le contrat d'écrivain (F25-16) ; le message TS nommé relève de la piste TS.
8. **Passerelles** : `persist…`, `save…` (`service_role`) et `atomic_create…` (`authenticated`) restent
   `security invoker` ; le schéma `private` leur est fermé. `public.estimate_v3_assert_draft_for_writer(uuid)`
   (`authenticated`, `service_role`) et `public.estimate_v3_compute_for_writer(uuid)` (`service_role`) sont
   `security definer` et refusent (`0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED`) hors du contrat d'écrivain de la
   version : même modèle de confiance que le contrat. Le lot et la duplication, `security definer`, appellent
   `private` directement. Aucune fonction existante ne change de mode.
9. **Contrôle de sauvegarde (D12)** : valeurs de ligne de M3 sans répartition ; R et A suivent les formules
   de `private.estimate_v3_compute_items` ; la répartition exacte n'est contrôlée qu'au gel, qui recalcule tout.
10. **Gel** : un contexte différent est un conflit à réessayer (`40001 …CONTEXT_CONFLICT`, comme la v2), une
    valeur différente un refus (`…PROJECTION_MISMATCH`) ; MO sans rôle refusée comme en v2
    (`ESTIMATE_V3_LABOR_ROLE_REQUIRED`).
11. **Concurrence politique ↔ création** : verrou consultatif `estimate-calc-policy:<entreprise>` exclusif dans
    l'écrivain, partagé dans la création et le gel, en plus de `FOR SHARE` (couvre la première écriture,
    sans ligne à verrouiller).
12. `updated_by` / `changed_by` : `on delete set null` (un profil supprimé ne bloque pas la suppression).
13. `unit_code` n'est pas normalisé en SQL : l'écrivain envoie un code ; la clé étrangère refuse le reste.

### 7.3 Sondes corrigées et assertions réécrites

- **Persistance (5 sondes, `db753d21`)** : F25-03 (RLS, journal), F25-10 (gel S1), F25-17 et F25-18 rendaient
  des booléens par `format()` / `concat_ws()`, qui écrivent `t`/`f` sous PostgreSQL 17.11
  (`select format('%s', true)` → `t`, `true::text` → `true`) alors que les attendus écrivent `true`/`false`.
  Rouge observé avec M4 appliquée, pour cette seule raison : 85/90, `have: …:t…` / `want: …:true…` ; sondes
  castées en `::text`, attendus inchangés : 90/90.
- **2.1 (`estimate-calc-engine-v3-guards`, §1.7)** : fixtures v3 avec coefficients, montants v3 et h/u
  (`h_mo / 2`) ; F-SQL-02 « RPC de création » → `ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` ; insertion v3 sans
  contrat avec coefficients ; F-SQL-10 lot, ligne et réglages réécrits sur la branche v3 (ancien contrat
  refusé, projection décalée d'1 c refusée — PU 4 301 au lieu de 4 300, PU 1 299 au lieu de 1 300 —,
  projection exacte écrite, coefficient enregistré) ; F-SQL-11 : une v3 se duplique en v3 (et en variante) ;
  F-SQL-14 : quatre entrées revues (`duplicate_estimate_version_without_product_id`,
  `freeze_estimate_v3_snapshot`, `private.estimate_v3_canonical_input`,
  `private.derive_estimate_item_v3_columns`) et motifs mis à jour ; diagnostic « aucune » entrée orpheline.
- **Gouvernance** : `pg_temp.governance_v3_fixture` avec coefficients, montants v3 et h/u.
- **2.4 (`estimate-engine-v3-functions`, F15)** : la sonde d'immuabilité exclut les trois lecteurs de lignes
  de M4 (stables par construction, D12) ; les sondes de privilèges les couvrent toujours.
- **Nouvelle suite `estimate-engine-v3-nonpriced.test.sql`** (F25-21, F25-22, R-08 et décision 3) : rouge
  avant M4 sur la pile possédée (3/3, `42883 set_tenant_calc_policy` absente), vert après.

### 7.4 Preuves (17/10/2026, WSL Ubuntu 24.04, Node 24.14.0, clone `~/miaouffrage-lot2-25` à `40ac4c9f`)

| Commande | Résultat |
|---|---|
| `npm run supabase:manifest:add` ; `npm run supabase:validate` (Windows) | 248 entrées ; « 248 files, 248 unique versions » |
| Itération : pile native possédée, M4 dans une transaction annulée + chaque suite | persistance 90/90, non chiffrées 3/3 ; les 17 autres suites vertes avant le dernier renommage du déclencheur, les quatre suites v3 et la gouvernance rejouées vertes après |
| `npm run db:ci:local` | sortie 0 : inventaire des migrations conforme au dépôt (248 fichiers) ; pgTAP `Files=19, Tests=1832`, `Result: PASS` (persistance 90 comprise) ; « Behavioral RLS matrix passed » ; journal `.e2e/lot2-2.5/green/db-ci-local-m4.log` du clone, SHA-256 `27ffb7dc1ff7340cd4d4ebc70cbe149ec1a90c3168a2aabbebf5ddba4ea227ea` |
| `npm run db:upgrade-check -- lot2-2-5` | sortie 0 : 244 migrations de base, fixture validée, 4 migrations du lot appliquées dont M4, **0 différence** (douze colonnes déclarées, valeurs neutres), contrôle négatif interne détecté ; preuve `.e2e/engine-v3/upgrade-check/2026-10-17T16-25-48-724Z-lot2-2-5/` |
| `npm run db:upgrade-check -- lot2-2-5 --negative-control` | sortie 1, exigée : 1 différence, exactement celle de la migration synthétique (`estimate_items …0112 pu_ht_cents: 1481 -> 1482`) ; preuve `…/2026-10-17T16-26-15-520Z-lot2-2-5-negative-control/` |

`git diff --stat` reste vide sur `estimate-calculations.ts` et `estimate-v2-snapshot.ts` (aucun TS dans la piste SQL).

### 7.5 Reste hors de la piste SQL

- `e2e/army/local/engine-v3-support.ts` (fixture v3 à `margin_multiplier` 1,5, sans coefficients, §1.7) viole
  désormais le CHECK de forme : le parcours de 2.1 `engine-v3-fail-closed` échouera tant qu'il n'est pas aligné.
- `src/types/database.ts`, correspondance des nouveaux codes d'erreur vers l'API, message
  `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`, parcours `V3P01` : piste TS.
