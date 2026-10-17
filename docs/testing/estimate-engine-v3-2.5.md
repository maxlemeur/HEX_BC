# Persistance, gel et règles v3, derrière la politique (sous-lot 2.5)

Statut : **intégré, revu et vert** (17/10/2026) : rouge écrit et observé avant le code (§4, §9.6), M4 (§7), serveur
TS et API (§8), intégration et preuves mesurées (§10), revue indépendante et correctifs, rouge puis vert (§10.5),
revue Codex de la PR #33 (§10.6) et revue de suivi de son correctif F4 (§10.6.1).
Document unique du sous-lot : l'ancien
`estimate-engine-v3-2.5-e2e.md` (parcours `V3P01`, isolation Vitest `R-01` à `R-05`) y est fondu au §9. Les
§1 à §6 et le §9 sont rédigés avant tout code de production, avec
`supabase/tests/database/estimate-engine-v3-persistence.test.sql`,
`e2e/army/local/engine-v3-persistence.e2e.ts` et `src/lib/estimates/rules-engine.v3-margin.test.ts`. Source :
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
  moteur suit la source, quelle que soit la politique (I4, P-15). *Revue (§10.5) : les `id` neufs d'une copie v3
  gardent l'ordre relatif des `id` source (ex aequo de D13), pour que ses montants copiés restent ceux du moteur
  sur la copie.*
- Métré : fonctions inchangées ; le contrat d'écrivain le refuse (`ESTIMATE_V3_WRITER_NOT_SUPPORTED`) ;
  le message TS `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED` reste en 2.8 (D16). *Remplacé à l'implémentation :
  décision 7 du §8.1, le refus nommé TS est livré en 2.5.*

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
commencent par l'identifiant). E2E et Vitest : §9.

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
| F25-18 | Duplication qui change moteur ou montants ; *copie dont les ex aequo D13 diffèrent de la source (revue)* | S2 dupliquée sous politique 2 : moteur 3, coefficients, intention, totaux et lignes identiques ; *huit copies : ordre relatif des `id` gardé, montants stockés = moteur sur la copie* | V3P-10, *V3P-16* |
| F25-19 | Montée de version : une ligne v1/v2 existante reçoit une valeur v3 | la v2 témoin n'a que des valeurs neutres ; preuve complète par `npm run db:upgrade-check` sur base peuplée (§10.2) | — |
| F25-20 | Règle `min_margin` calculée depuis 0 sur un brouillon v3 sans preuve ; T-MARG non violée | — | Vitest `R-01` à `R-05` (`src/lib/estimates/rules-engine.v3-margin.test.ts`) |
| *F25-23* | *Revue Codex (§10.6) : gel v3 resté frais après un changement de taux horaire d'un rôle cité ou une bascule d'`EST_031_LABOR_SPLIT`* | *S1 gelé par `freeze_estimate_v3_snapshot` : marqueur et contexte NULL, file NULL (taux, drapeau inséré, drapeau existant basculé)* | *Vitest `R-01` (marqueur NULL → « indisponible »)* |
| *F25-24* | *Revue Codex (§10.6) : propriétaire d'une affaire v3 changé, ou rôle cité déplacé, qui casse ensuite sauvegardes et gel* | *v3 canoniques : `ESTIMATE_PROJECT_OWNER_LABOR_ROLE_MISMATCH` (administrateur et postgres), `ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE` (rôle déplacé ou supprimé)* | *—* |
| *F25-25* | *Revue Codex (§10.6) : suppression directe d'une ligne v3 qui laisse les montants stockés périmés ; ou refus qui casse le lot et les cascades* | *cinq suppressions hors contrat refusées ; contrat, lot (section et ligne), version et affaire supprimées (directe, `bulk_delete_draft_affaires`) admis* | *V3P-18 (lot, `DELETE /api/affaires/{id}`)* |

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
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3P01|V3FC"
npm run db:upgrade-check -- lot2-2-5            # puis -- lot2-2-5 --negative-control (doit échouer)
npm run engine:document-fingerprints -- check
npm run engine:v3:parity
npm run e2e:army:calc-v3
# Windows ou WSL
npx vitest run --project=node src/lib/estimates/rules-engine.v3-margin.test.ts
npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts
```

Au vert (implémentation) : la même suite sans modification d'assertion, après M3 et M4 ; suites 2.1 et
gouvernance réécrites selon le §1.7 ; `npm run db:upgrade-check -- lot2-2-5` à 0 différence ; corpus figé
et empreintes documentaires identiques ; `git diff --stat` vide sur `estimate-calculations.ts` et
`estimate-v2-snapshot.ts`.

## 6. Limites et points ouverts

- **Lignes non chiffrées** (`pricing_status` ≠ `priced`) : M3 ne leur donne pas de PU, mais
  `estimate_items_item_type_payload_check` exige `pu_ht_cents` non nul sur toute ligne, et le gel v2
  exige une ligne figée par ligne. Leur stockage et leur gel ne sont pas fixés par ce rouge (T-STAT reste
  couvert par 2.4) : décision à prendre à l'implémentation, puis assertion à ajouter. *Tranché : décision 3
  (§8.1), choix 3 du §7.2, suite `estimate-engine-v3-nonpriced.test.sql` (F25-21, F25-22).*
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
| Lignes, écritures directes | v1/v2 : colonnes v3 non nulles ou statut ≠ `priced` → `0A000 ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`. v3 : sept colonnes sous contrat d'écrivain (`0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED`) ; `h_mo > 0` sans h/u, ou `h_mo*` modifié seul → `22023 ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`. *Revue Codex (§10.6) : suppression d'une ligne d'un brouillon v3 sous contrat d'écrivain seulement (`0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED`), cascades d'une version ou d'une affaire supprimée admises* |

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
  désormais le CHECK de forme : le parcours de 2.1 `engine-v3-fail-closed` échouera tant qu'il n'est pas aligné
  (aligné à l'intégration, §10.2).
- `src/types/database.ts`, correspondance des nouveaux codes d'erreur vers l'API, message
  `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`, parcours `V3P01` : piste TS.

## 8. Implémentation TypeScript (serveur et API)

Piste TS du sous-lot, parallèle à la migration M4 (`20261017162000_estimate_engine_v3_persistence.sql`,
piste SQL, §7) ; le TS tient l'interface du §7.1 telle quelle. Aucun montant v1/v2 ne change :
`estimate-calculations.ts` et `estimate-v2-snapshot.ts` à zéro ligne de diff, corpus figé
(`engine-frozen-corpus.test.ts`) vert.

### 8.1 Décisions prises pour l'implémentation (17/10/2026)

1. **R-08** : une ligne v3 non chiffrée porte `h_mo*` = `"0.000"` si h/u est saisi (nul sinon), comme
   `private.estimate_v3_line_values` de M3 ; le déclencheur de dérivation l'appelle (piste SQL). Le TS
   n'envoie jamais `h_mo*` pour une v3 : un total nul (défaut des écrivains historiques) est retiré, un
   total positif refusé (`ESTIMATE_V3_LABOR_HOURS_PER_UNIT_REQUIRED`).
2. **Autoliquidation v3** = `contractor_role = 'subcontractor'`, comme en v2 ; le gel la transmet au jumeau
   SQL par l'entrée canonique (`reverse_charge`).
3. **Ligne v3 non chiffrée** : `pu_ht_cents` nul (moteur et futur contrat client 2) ; projections et gel
   le transmettent nul, jamais un faux PU (`estimate_items_item_type_payload_check` relâché par M4 pour
   ce seul cas).
4. **CHECK de forme §6.2** avec `is not null` explicite sur les cinq colonnes v3 (piste SQL).
5. **Colonnes v3 des modèles** : M6 (2.8), pas M4.
6. **Une v3 reste modifiable, gelable et duplicable sous politique 2** (D3, I4) ; la duplication d'une v2
   reste une v2 (P-15). La politique ne gouverne que la création.
7. **Métré sur une v3** refusé par son nom en TS (`TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`, 409) avant le
   contrat d'écrivain SQL (*prouvé depuis la revue par V3P-17, rouge observé sans le refus TS, §10.5*). **Émission** (PDF, envoi, documents) toujours fermée : le gel v3 n'est ouvert
   que pour l'approbation ; envoi et document lèvent `ESTIMATE_ENGINE_UNAVAILABLE` (2.7 l'ouvrira).

### 8.2 Choix de la piste TS

- **Politique** (`calc-policy-server.ts`) : lue par le client de l'utilisateur (RLS membres), absente =
  moteur 2. `resolveNewEstimateEngine` compare l'attente du client (`version.expected_calc_engine_version`,
  absente = 2) à la politique et lève 409 `CONTEXT_CHANGED` avant tout calcul ; la RPC revérifie sous verrou
  et son `40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` est rendu en 409 `CONTEXT_CHANGED`.
- **Création v3** (`canonical-v2-creation.ts`) : seulement à blanc. Modèle, import DPGF et source liée vers
  une v3 lèvent `ESTIMATE_ENGINE_UNAVAILABLE` (conversions de 2.8, D16). Une v3 ne reprend de la dernière
  version que des réglages neutres (date, validité, devise, TVA, profondeur, rôle d'entreprise), jamais une
  marge, un coefficient global ou deux intentions de remise d'une v2 ; coefficients de vente fournis ou de la
  politique ; forme §6.2 vérifiée en TS (`ESTIMATE_V3_VERSION_SETTINGS_INVALID`, 400).
- **Calcul** : `calculateEstimateV3SnapshotForItems` (`version-totals.ts`) lit les taux des rôles du
  propriétaire (refus `ESTIMATE_LABOR_ROLE_OWNER_MISMATCH`, comme la v2), la ventilation de l'entreprise,
  aucun barème, puis passe par la façade `computeVersionBreakdown` (moteur pur 2.4) et
  `projectEstimateV3Snapshot`. Une `EstimateV3Error` devient un 400 à son code.
- **Lot, ligne, réglages** : colonnes `unit_code` (normalisée par `src/lib/units`, « ML » → `ml`, inconnue
  refusée `ESTIMATE_V3_UNIT_UNKNOWN`), `pricing_status`, `h_mo*_per_unit` acceptées par le schéma Zod
  (`v3-schemas.ts`) et la forme canonique du lot ; refusées sur une v1/v2 et sur une section
  (`ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`). Toutes les lignes d'une v3 sont projetées (remise et TVA par
  taux les touchent toutes). Réglages : aiguillage à trois branches, aucune intention dérivée (deux intentions
  = refus), `apply_tax_rate_to_lines` transmis dans la charge de réglages, sans `margin_multiplier`.
- **Gel v3** (`v3-snapshot-server.ts`) : contrôles nommés en TS avant la RPC (rôle requis, unité requise,
  taux autorisé par la politique), puis `freeze_estimate_v3_snapshot`. Le contrôle « nature de ligne
  incohérente » du gel v2 n'est pas appliqué à la v3 : en v3 la MO vient des heures par unité, et une ligne
  `supply_only` à 0 h/u qui porte un rôle (O3 de l'oracle) n'a aucune MO.
- **Marque nette** (`v3-margin-evidence-server.ts`, `effective-margin.ts`) : preuve vivante d'un brouillon v3,
  liée à l'identité et à la révision, donnée seulement si le calcul vivant retrouve exactement les six
  montants stockés ; sinon gel v3 frais (`cost_subtotal_cents`, jamais `effective_margin_multiplier`) ;
  sinon « indisponible ». Version relue différente ou écrite pendant le calcul : pas de preuve (jamais 409).
  La règle `min_margin` d'une v3 rend `margin_bp` indisponible au lieu de 0 ; v1/v2 inchangées.
- **Remise exacte v3** (`effective-discount.ts`) : intention en taux lue dans `discount_bp` (exacte) ;
  intention en montant prouvée seulement par un gel v3 frais dont `discount` retrouve brut et remise stockés.
- **Direction et analyse d'affaire** : marque v3 par la preuve ou le gel ; l'analyse de marge d'une v3 passe par
  la façade (`affaires/margin-analysis-v3.ts`, coût = Σ D, vente = HT net, par section racine).
- **Types** (`src/types/database.ts`, CRLF, D18) : tables `tenant_calc_policies` et
  `tenant_calc_policy_events`, fonctions `set_tenant_calc_policy` et `freeze_estimate_v3_snapshot`, colonnes
  v3. Les colonnes v3 des lignes et des versions sont **optionnelles** dans `Row`, comme `line_nature`, `aid`
  et `product_id` : les fixtures v1/v2 existantes restent valides sans réécriture.
- **Prédicats** : `usesSaleCoefficients` et `usesPerUnitLabor` (`engine/capabilities.ts`, D1) et
  `resolveEstimateEngineVersion` (`calc-engine-version.ts`, tolérance historique pour 1 et 2, 3 rendu tel quel).

### 8.3 Assertions existantes réécrites (fausses par construction) et fixture adaptée

| Fichier | Avant (2.1) | Après (2.5) |
|---|---|---|
| `approval-v2-snapshot.test.ts` | un brouillon v3 est refusé par son nom | il est figé par le gel v3, jamais par le gel v2 |
| `settings-atomic.test.ts` | les réglages v3 sont refusés par leur nom | ils passent par le moteur 3, sept totaux, sans multiplicateur réécrit |
| `openapi/generate.test.ts` | `calc_engine_version` ∈ {1, 2} dans la réponse | ∈ {1, 2, 3} |
| `canonical-v2-creation.test.ts` | — | fixture : la lecture de politique répond « absente » (aucune assertion modifiée) |
| `rules-engine.v3-margin.test.ts` | type `V3MarginEvidence` recopié | `import type` depuis le module, comme prévu au §9.4 ; assertions inchangées |

### 8.4 Preuves (Windows, worktree `miaouffrage-l2-25`)

| Commande | Résultat |
|---|---|
| `npx vitest run --project=node src/lib/estimates/rules-engine.v3-margin.test.ts` | 5/5 verts (rouges 5/5 au §9.6) |
| Vitest des modules touchés (33 fichiers, corpus figé compris) | 33 fichiers, 431 tests verts |
| `npm run typecheck` | 0 erreur |
| `npx eslint <37 fichiers TS touchés> --max-warnings=0` | 0 |
| `npm run generate-openapi && npm run validate-openapi` | spec valide et synchronisée (144 routes, 192 opérations) |
| `npm run check:architecture` | budgets respectés, 0 cycle |
| `git diff --stat` sur `estimate-calculations.ts`, `estimate-v2-snapshot.ts` | vide |

Le parcours `V3P01` et `npm run db:ci:local` se rejouent à l'intégration (WSL), avec M4.

### 8.5 Limites

- L'évolution de marge par version (hub d'affaire) lit encore `margin_multiplier` (1 en v3) : affichage
  seulement, repris avec l'éditeur v3 (2.6). *Corrigé à la revue (§10.5, V3P-14) : le résumé financier du hub, le
  tableau dense et l'aperçu de soumission rendent la marque nette d'un gel v3 frais ou « Indisponible » ; les v3
  sortent de l'évolution, dont la marge v2 ne se compare pas à leur marque.*
- Pas de preuve vivante de remise en montant pour un brouillon v3 (règle `max_discount` indisponible tant
  qu'il n'est pas gelé) ; Direction idem.
- Mise à jour unitaire d'une ligne, mise à jour groupée directe, ouvrages, modèles, version zéro et métré
  restent refusés sur une v3 (nommés en TS ou par le contrat d'écrivain) jusqu'à 2.6 et 2.8.
- Codes SQL rendus par l'API : `ESTIMATE_V3_PROJECTION_MISMATCH` en 400 (réglages, ligne, gel ; 500 à la
  création, que le TS n'envoie que calculée par le moteur pur), `ESTIMATE_V3_UNIT_REQUIRED`,
  `ESTIMATE_V3_TAX_RATE_NOT_ALLOWED`, `ESTIMATE_V3_LABOR_ROLE_REQUIRED` en 400 à leur nom,
  `ESTIMATE_V3_CALCULATION_CONTEXT_CONFLICT` en 409 `CONTEXT_CHANGED`.
- `e2e/army/local/engine-v3-support.ts` (fixture v3 de 2.1 à `margin_multiplier` 1,5, sans coefficients) viole le
  CHECK de forme de M4 (§7.5) : hors de cette piste ; aligné à l'intégration (§10.2).

## 9. Parcours E2E `V3P01` et isolation des règles (rouge d'abord)

Fondu de l'ancien `estimate-engine-v3-2.5-e2e.md`, rédigé avant tout code de production et avant M4 (conception §14
« 2.5 », D3, D4, D5, D6, D8, D12, D14, D15, §5.1 à §5.3, §6.2 à §6.5). Les renvois « §5.x » et « §6.x » de cette
section visent la conception.

Fichiers :

| Fichier | Rôle |
|---|---|
| `e2e/army/local/engine-v3-persistence.e2e.ts` | Parcours `V3P01` (sélection critique locale, motif `engine-v3-*.e2e.ts` déjà listé dans `e2e.config.ts` par 2.1 : aucun enregistrement à ajouter) |
| `e2e/army/local/engine-v3-persistence-support.ts` | Préalables SQL sur la pile possédée : sonde du schéma M4, politique par `set_tenant_calc_policy` en `service_role`, règle de marge limitée à l'affaire |
| `src/lib/estimates/rules-engine.v3-margin.test.ts` | Isolation Vitest `R-01` à `R-05` (`min_margin` sur une v3, F20, T-MARG) |

`scripts/tester-army/army-impact-map.json` (PR #28, arrivée par la fusion de `main`) : parcours enregistré à l'intégration (§10.2).

### 9.1 Défaillances observables et scénario qui les expose

| Id | Défaillance observable | Exposée par |
|---|---|---|
| V3P-01 | La politique typée n'existe pas (table, journal, écrivain), ni les colonnes v3 de version et de ligne, ni le gel v3 : aucune v3 ne peut naître | Sonde `probeV3PersistenceSchema` comparée à l'état complet attendu ; **premier rouge avant M4** |
| V3P-02 | Sous politique 3, une création sans moteur attendu réussit (v2 ou v3) au lieu de lever `CONTEXT_CHANGED` sans rien écrire ; sous politique 2, une attente 3 réussit | Deux créations refusées, nombre de versions de l'affaire inchangé (lecture SQL) |
| V3P-03 | Une v3 créée ne porte pas les coefficients de la politique (1,30 / 1,20), ou garde une marge, un coefficient global, une remise ou un arrondi non neutres | Relecture `GET` des deux v3 créées : forme vide exacte |
| V3P-04 | `unit_code`, `pricing_status` ou `h_mo_per_unit` sont ignorés ou perdus par le lot (le schéma Zod actuel retire en silence les clés inconnues) ; `h_mo` n'est pas dérivé de Q × h/u | Lot de 7 lignes, relecture ligne par ligne |
| V3P-05 | Un PU, un net, une TVA de ligne ou un total diffère d'un centime de l'oracle | S1 exact par ligne et en pied |
| V3P-06 | L'éditeur v2 s'ouvre sur une v3 persistée et la réécrit (l'éditeur v3 n'arrive qu'en 2.6) | Bandeau 2.1 visible, révision, totaux et lignes inchangés |
| V3P-07 | Une intention de remise est dérivée de l'autre ; le montant appliqué est faux ; la remise en taux ne suit pas le brut quand c_FO change (EUHIST) | S2, S3, EUHIST |
| V3P-08 | « Appliquer à toutes les lignes » ne change que la version ou une partie des lignes ; TVA calculée ligne à ligne | TVA 10 % : version et 7 lignes à 1 000 pb, TVA par taux sur la base nette |
| V3P-09 | Le gel d'approbation n'est pas un gel v3 (contexte, bruts figés, FO/MO nets) ; la marque nette lue par la règle ou par la file vaut 0, NULL ou une valeur fausse | Résumé d'approbation, soumission, relecture du gel, carte de la file `/dashboard/approvals` |
| V3P-10 | La duplication rend une v2, perd une colonne v3 ou change un montant | Duplication **sous politique 2** de la v3 gelée |
| V3P-11 | Politique remise à 2 : la création suivante n'est pas une v2 aux valeurs de base de 2.0 (2 000 / 400 / 2 400) ou hérite d'une colonne v3 | Création v2, ligne 1 u à 20,00 € |
| V3P-12 | Une version existante change de moteur ou de montant quand la politique change | Empreinte finale (moteur, révision, totaux, lignes) de l'ancre v2, de l'oracle, d'EUHIST et de la copie |
| V3P-13 | *Revue (§10.5).* Des coefficients de vente fournis à la création sont retirés en silence (v3 : politique à la place) ou ignorés (v2 créée) | v3 « coefficients fournis » (1 ; 1,5) dans la fenêtre ; sous politique 2, v2 avec coefficient → 400 nommé, rien de créé |
| V3P-14 | *Revue.* Le résumé financier du hub affiche pour une v3 la marge v2 (multiplicateur 1 → « 0.0 % », « Coeff. 1.000 ») | KPI « Marge appliquée » du hub, oracle courant en S1 non gelé : « Indisponible » |
| V3P-15 | *Revue.* `DELETE …/items` supprime une ligne v3 sans rien recalculer : six montants stockés périmés (D12) | EUHIST : 409 `ESTIMATE_ENGINE_UNAVAILABLE`, empreinte inchangée |
| V3P-16 | *Revue.* Une ligne non chiffrée à un taux hors politique bloque le gel (contrôle TS sur toutes les lignes) ; le lot ou le gel d'une copie déplace un centime | Copie : ligne « pour mémoire » à 1 960 pb par lot, soumission 201, gel frais, lignes et totaux inchangés |
| V3P-17 | *Revue.* Le métré appliqué à une v3 n'est pas refusé par son nom | Job de métré terminé sur EUHIST : 409 `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`, empreinte inchangée |

### 9.2 Déroulé du parcours `V3P01`

Entreprise de recette : celle du lanceur `run-tester-army-ci.ts` (compte neuf, entreprise personnelle `ARMY CI …`).
Toutes les écritures métier passent par l'API de l'application dans la page connectée ; seules la politique
(aucun écrivain applicatif pendant le lot 2, P-13) et la règle de marge passent par le propriétaire natif
`postgres` de la pile possédée (`E2E_ARMY_LOCAL_DB_URL`, `E2E_ARMY_LOCAL_PSQL`), sous garde : entreprise active
nommée `ARMY…`, administrée par le compte connecté. *Corrigé à l'intégration (§10.2, C1) : `V3P01` court sous un
propriétaire dédié (compte jetable inscrit sur la pile possédée, entreprise personnelle `ARMY V3P <run>`), jamais
dans l'entreprise de recette partagée.*

1. **Préparation (indépendante de M4).** Affaire `ARMY-L2-V3-<run>` et ancre v2 par `POST /api/estimates` ;
   rôle « Tuyauteur » à 4 000 c/h du propriétaire, créé par `POST /api/estimates/{ancre}/labor-roles` (ou
   repris s'il existe déjà à 4 000 c/h, en cas de relance).
2. **Sonde du schéma (V3P-01).** Attendu : `tenant_calc_policies`, `tenant_calc_policy_events`,
   `set_tenant_calc_policy`, `freeze_estimate_v3_snapshot`, type `estimate_line_pricing_status`, et aucune
   colonne manquante parmi `sale_coefficient_fo`, `sale_coefficient_mo`, `gross_ht_cents`,
   `discount_applied_cents`, `commercial_rounding_cents` (versions) et `unit_code`, `pricing_status`,
   `h_mo_per_unit`, `h_mo_atelier_per_unit`, `h_mo_chantier_per_unit`, `snapshot_gross_ht_cents`,
   `snapshot_gross_fo_ht_cents` (lignes). Politique absente ou à 2 au départ.
3. **Fenêtre de politique 3 (V3P-02, V3P-03).** Politique 3 (1,30 / 1,20, taux autorisés par défaut
   `{2000,1000,550,210}`) ; création sans attente → 409 `CONTEXT_CHANGED`, nombre de versions inchangé ;
   création de l'oracle et d'EUHIST avec `expected_calc_engine_version: 3` → 201 (*EUHIST d'abord depuis
   l'intégration, §10.2, C3*) ; politique remise à 2 dans un
   `finally` (un événement de journal de plus). Les deux v3 relues : moteur 3, coefficients [1,3 ; 1,2], marge
   `fixed` ×1, coefficient global 1, remise simple 0 et montant nul, brut, remise appliquée, arrondi commercial
   et ajustement à 0, TVA 2 000 pb, totaux [0, 0, 0].
4. **Oracle (V3P-04, V3P-05).** Verrou, une section, puis les 7 lignes en **un** `POST …/batch` validé
   (`committed: true`, aucune opération en erreur). *Depuis l'intégration (§10.2, C6), un second lot les réétiquette
   dans l'ordre des `id` de la fixture du moteur pur, dont dépendent les ex aequo de D13.* Attendu S1 :

   | Ligne | Unité | Q | PR FO | h/u | h_mo | PU | Net | TVA 20 % | TTC |
   |---|---|---|---|---|---|---|---|---|---|
   | O1 | ml | 20 | 5 466 | 1,991 | 39,82 | 16 663 | 333 260 | 66 652 | 399 912 |
   | O2 | u | 3 | 9 563 | 1,75 | 5,25 | 20 832 | 62 496 | 12 499 | 74 995 |
   | O3 | m2 | 21 | 5 850 | 0 | 0 | 7 605 | 159 705 | 31 941 | 191 646 |
   | O4 | ml | 1 139 | 302 | 0,2 | 227,8 | 1 353 | 1 541 067 | 308 213 | 1 849 280 |
   | O5 | u | 1 | 2 000 | 6 | 6 | 31 400 | 31 400 | 6 280 | 37 680 |
   | O6 | ml | 282 | 9 186 | 0,998 | 281,436 | 16 732 | 4 718 424 | 943 685 | 5 662 109 |
   | O7 | ml | 8 | 883 | 1,30 | 10,4 | 7 388 | 59 104 | 11 821 | 70 925 |

   Version : brut 6 905 456 ; HT 6 905 456, TVA 1 381 091, TTC 8 286 547 (S1).
5. **Lecture à l'écran.** L'éditeur de l'oracle affiche le bandeau de 2.1 et ne réécrit rien (V3P-06) ; la liste
   `/dashboard/estimates`, filtrée sur l'affaire, affiche « 69 054,56 € » sur la ligne de l'oracle. *Corrigé à
   l'intégration (§10.2, C2, C3) : `/dashboard/estimates` redirige vers `/dashboard/affaires` ; la lecture se fait
   dans la liste des versions du hub `/dashboard/affaires/{affaire}`, même valeur attendue.*
6. **Réglages (V3P-07, V3P-08)**, chacun par `PATCH /api/estimates/{id}` avec `expected_content_revision` et
   `If-Match`, révision incrémentée (*bail repris pour le document courant avant chaque sauvegarde depuis
   l'intégration, §10.2, C4*) :
   - S2 `{discount_amount_cents: 101, discount_bp: 0}` → montant 101, `discount_bp` 0, appliqué 101 ;
     nets [333 255, 62 495, 159 703, 1 541 044, 31 400, 4 718 355, 59 103] ; 6 905 355 / 1 381 071 / 8 286 426 ;
   - S3 `{discount_amount_cents: null, discount_bp: 1000}` → appliqué 690 546 ;
     nets [299 934, 56 246, 143 735, 1 386 960, 28 260, 4 246 581, 53 194] ; 6 214 910 / 1 242 982 / 7 457 892 ;
   - TVA `{tax_rate_bp: 1000, apply_tax_rate_to_lines: true}` → version et 7 lignes à 1 000 pb ;
     TVA de ligne [29 993, 5 625, 14 374, 138 696, 2 826, 424 658, 5 319] ; 6 214 910 / 621 491 / 6 836 401 ;
   - EUHIST (seconde v3, une ligne 1 u à 200 c, h/u 0) : PU 260 à c_FO 1,30, puis
     `{sale_coefficient_fo: 1, discount_bp: 1000}` → brut 200, appliqué 20, 180 / 36 / 216, puis
     `{sale_coefficient_fo: 2}` → brut 400, appliqué 40, 360 / 72 / 432, `discount_bp` 1 000, montant nul.
7. **Gel et règle (V3P-09).** Règle `min_margin` 1 500 pb, action `require_approval`, portée `client` = l'affaire
   (seule portée qui n'atteint pas les parcours concurrents). `GET …/approval` : raison de la règle avec
   `actualValue` 1 171, `thresholdValue` 1 500, `sourceState` `ready`, `approvalStatus` `missing`. Soumission
   `submit_for_review` (voir §9.3.4) → 200 (*201 : contrat inchangé de la route, §10.2, C5*). Relecture : montants inchangés, `approval_status` `in_review`, gel frais
   (`calc_snapshot_content_revision` = `content_revision`), contexte v3 (§6.5) : `engine` 3,
   `sale_coefficients` {1,3 ; 1,2}, `discount` {`rate`, demandé nul, 1 000 pb, base 6 905 456, appliqué 690 546},
   `commercial_rounding` {`none`, 1, 0}, `cost_subtotal_cents` 5 487 177, `realized_sale_coefficient` 1,132624,
   `tax_breakdown` [{1 000 ; 6 214 910 ; 621 491}], sans `effective_margin_multiplier`. Lignes figées
   (`snapshot_pu_ht_cents`, `snapshot_gross_ht_cents`, `snapshot_gross_fo_ht_cents`, `snapshot_fo_ht_cents`,
   `snapshot_mo_ht_cents`) : PU et bruts de l'oracle ; FO brut [142 119, 37 296, 159 705, 447 304, 2 600,
   3 367 547, 9 183] ; FO net [127 907, 33 566, 143 735, 402 574, 2 340, 3 030 792, 8 265] ; MO nette
   [172 027, 22 680, 0, 984 386, 25 920, 1 215 789, 44 929]. File `/dashboard/approvals` : la carte de l'affaire
   affiche « 62 149,10 € HT » et « Marge 11.7 % » (format actuel de `ApprovalQueueCard`, `toFixed(1)`).
8. **Duplication (V3P-10)**, après le retour de la politique à 2 : 201, copie en brouillon, moteur 3, mêmes
   coefficients, intention, taux, totaux et lignes que l'état « TVA 10 % ».
9. **Politique 2 (V3P-11).** Création avec `expected_calc_engine_version: 3` → 409 `CONTEXT_CHANGED`, rien
   d'écrit ; création sans attente → v2 ; une ligne 1 u à 2 000 c → 2 000 / 400 / 2 400, coefficients, brut,
   remise appliquée et arrondi commercial nuls, ajustement 0, ligne sans unité ni h/u, statut `priced`.
10. **Stabilité (V3P-12).** Moteur, révision, totaux et lignes de l'ancre v2, de l'oracle gelé, d'EUHIST et de la
    copie identiques à leur dernier état relu (`updated_at` exclu : les projections d'approbation peuvent
    l'avancer sans toucher au contenu).
11. **Revue (V3P-13 à V3P-17, §10.5).** Relevées à leur place (création dans la fenêtre, KPI du hub à l'étape 5)
    ou après V3P-12 (copie, métré, suppression, v2 avec coefficient), assertées ensemble en fin de parcours
    (`REVIEW_EXPECTED`) pour qu'une seule exécution rouge les montre toutes, sans toucher un attendu des étapes 1
    à 10. L'étape 4 asserte en outre l'état du lot de création lui-même, par titre, avant le réétiquetage.

Origine des attendus : PU, bruts, déboursé et totaux S1 à S3 recopiés de la conception (§5.1, §5.2) ;
répartitions par ligne (plus grand reste, D13), état « TVA 10 % », marque 1 171 pb et parts figées calculés par
le moteur pur 2.4 (`computeEstimateV3Breakdown` sur `oracleInput`, `computeEstimateV3NetMarginBp`), dont les
totaux égalent la conception au centime. Tolérance : 0 c (§5.5), en base comme à l'écran.

Preuves : chaque étape écrit `recordEvidence` (`v3p-schema`, `v3p-policy-window`, `v3p-batch-*`, `v3p-s1`,
`v3p-settings-*`, `v3p-approval-summary`, `v3p-freeze`, `v3p-approval-queue`, `v3p-duplicate`,
`v3p-policy-2`, `v3p-v2-baseline`, `v3p-final`) avec attendu et obtenu, sous
`.e2e/army/critical/artifacts/business/`, archivé par le lanceur sous `.e2e/army/ci/<horodatage>-critical/`.

### 9.3 Contrat d'API et d'écran que l'implémentation doit tenir

#### 9.3.1 SQL (M4, appelé par la fixture)

- `public.set_tenant_calc_policy(p_tenant_id uuid, p_new_estimate_calc_engine smallint,
  p_default_sale_coefficient_fo numeric, p_default_sale_coefficient_mo numeric, p_allowed_tax_rates_bp integer[],
  p_change_reason text, p_actor_user_id uuid)` (signature du pgTAP `estimate-engine-v3-persistence.test.sql`) :
  appel par **arguments nommés**, en `service_role` (`SET LOCAL ROLE service_role`), taux
  `{2000,1000,550,210}`, auteur = le propriétaire de la recette. Une écriture = un événement dans
  `tenant_calc_policy_events` (`tenant_id`).
- Création : l'attente de moteur reçue par l'API (`version.expected_calc_engine_version`) est transmise à
  `persist_estimate_creation_atomic` dans la charge de version (`calc_engine_version`, comme le pgTAP) ; l'écart
  SQL `40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` est rendu par l'API en 409 `CONTEXT_CHANGED`.
- `public.tenant_calc_policies` : colonnes `tenant_id`, `new_estimate_calc_engine`,
  `default_sale_coefficient_fo`, `default_sale_coefficient_mo`, `allowed_tax_rates_bp`, `change_reason` (§6.3).
- `public.estimate_rules` inchangée (insertion `min_margin` / `client` / `require_approval`).
- `public.freeze_estimate_v3_snapshot` existe (la sonde ne vérifie que son nom).

#### 9.3.2 Routes et charges utiles

| Route | Requête (champs v3 ou nouveaux) | Réponse attendue |
|---|---|---|
| `POST /api/estimates` | `version.expected_calc_engine_version` (1, 2 ou 3) ; absent = 2 (D3) | 201 `{project, version}` ; écart avec la politique : 409 `CONTEXT_CHANGED`, aucune ligne écrite |
| `POST /api/estimates/{id}/lock` | — | 201 |
| `POST /api/estimates/{id}/items` | section inchangée | 201 `{item}` |
| `POST /api/estimates/{id}/batch` | `operations[].data` des créations de ligne : `unit_code`, `pricing_status`, `h_mo_per_unit` (sans `h_mo`), `labor_role_id`, `tax_rate_bp` ; en-tête `If-Match` | 200 `{committed: true, results[]}` sans `status: "error"` |
| `PATCH /api/estimates/{id}` | `sale_coefficient_fo`, `sale_coefficient_mo`, `discount_bp`, `discount_amount_cents` (nul pour effacer), `tax_rate_bp`, `apply_tax_rate_to_lines: true` ; `expected_content_revision` et `If-Match` | 200 ; aucune intention dérivée, révision incrémentée |
| `GET /api/estimates/{id}` | — | `version` : `calc_engine_version`, `sale_coefficient_fo`, `sale_coefficient_mo`, `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents`, `rounding_adjustment_cents`, `discount_bp`, `discount_amount_cents`, `discount_mode`, `margin_mode`, `margin_multiplier`, `global_coefficient`, `tax_rate_bp`, `total_*`, `content_revision`, `calc_snapshot_content_revision`, `calc_snapshot_context`, `approval_status`, `status` ; `items[]` : `unit_code`, `pricing_status`, `quantity`, `unit_price_ht_cents`, `h_mo_per_unit`, `h_mo`, `pu_ht_cents`, `line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents`, `tax_rate_bp`, `snapshot_pu_ht_cents`, `snapshot_gross_ht_cents`, `snapshot_gross_fo_ht_cents`, `snapshot_fo_ht_cents`, `snapshot_mo_ht_cents`, `position`, `item_type` ; `labor_roles[]` |
| `POST /api/estimates/{id}/labor-roles` | `{name, hourly_rate_cents}` sur l'ancre v2 | 201 `{labor_role}` |
| `GET /api/estimates/{id}/approval` | — | `reasons[]` avec `ruleId`, `actualValue` (marque nette v3 en pb), `thresholdValue`, `sourceState`, `approvalStatus` |
| `POST /api/estimates/{id}/approve` | `{action: "submit_for_review", rule_ids, submission_message}` | 200 (*201 en réalité, §10.2, C5*) ; gel v3 avant l'ouverture du cycle (`approval-v2-snapshot.ts` aiguille vers `v3-snapshot-server.ts`) |
| `POST /api/estimates/{id}/duplicate` | — | 201 `{version_id}` ; moteur conservé quelle que soit la politique (I4) |

Les colonnes numériques (`sale_coefficient_*`, `quantity`, `h_mo*`) sont comparées après `Number()` : un
`numeric` rendu en chaîne par PostgREST passe, une valeur différente non.

#### 9.3.3 Écrans

| Écran | Sélecteur | Attendu |
|---|---|---|
| `/dashboard/estimates/{id}/edit` (v3) | `getByText(BANNER, {exact: true})`, texte de `ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE` | Bandeau visible en 2.5 ; 2.6 remplacera cette assertion |
| `/dashboard/estimates` | `getByPlaceholder("Rechercher par projet ou client...")`, puis la ligne `tr` du lien `a[href="/dashboard/estimates/{id}"]` | « 69 054,56 € » (espaces normalisés). *Remplacé (§10.2, C2) : `/dashboard/affaires/{affaire}`, élément `li` de la liste des versions qui porte le lien `a[href="/dashboard/estimates/{id}/edit"]`* |
| `/dashboard/approvals` | `article` dont le `h2` vaut le nom de l'affaire | « 62 149,10 € HT » et « Marge 11.7 % » |

TVA et TTC d'une v3 ne s'affichent sur aucun écran en 2.5 (éditeur en 2.6, document en 2.7) : elles sont
assertées à l'API.

#### 9.3.4 Sonde d'approbation hors navigateur

Le garde de la campagne critique (`restrictCriticalBrowser`) bloque tout `POST …/approve` du navigateur. Comme
la sonde d'envoi de 2.1, la soumission part du processus du parcours vers l'application possédée
(`http://localhost:<port>` seulement), avec les cookies de session de la page, et exige
`RESEND_API_KEY` vide (aucune notification ne quitte la machine). Elle ne vise que l'oracle de la recette.

### 9.4 Isolation Vitest des règles (`R-01` à `R-05`)

**Justification (F20, intégrité des règles).** Le parcours ne voit qu'une v3 gelée et soumise. Montrer en E2E
qu'un brouillon v3 **sans preuve** n'est jamais lu comme une marque de 0 % exigerait une règle bloquante active
pendant la campagne critique ; une règle globale atteindrait les parcours concurrents de la même entreprise, et
une règle limitée à l'affaire ne couvre pas les combinaisons ci-dessous (preuve périmée, HT nul, clé v2 égarée).
Le défaut est un calcul pur de `evaluateRules` sur des entrées connues : l'isolation le reproduit exactement.

| Id | Défaillance | Cas |
|---|---|---|
| R-01 | Brouillon v3 sans preuve : violation à 0 au lieu d'un signal indisponible | `violations` vide, `unavailableSignals` = [`min_margin`, `margin_bp`, `>=`, `unavailable`] |
| R-02 | Marque inventée depuis une preuve d'une autre révision, un gel périmé ou un HT nul | trois cas, tous indisponibles |
| R-03 | Contexte v3 lu par la clé v2 `effective_margin_multiplier` | gel frais HT 60 000, déboursé 48 000, clé ×1,1 égarée : aucune violation à 15 %, `actual_value` 2 000 à 20,01 % |
| R-04 | T-MARG : la marque ne suit pas la preuve | 1,25 / 1,25, remise 20 % : violation à 0 % pour 15 % ; sans remise (20 %) : rien |
| R-05 | Marque d'un gel frais mal arrondie | oracle S3 + TVA 10 % : 1 171 pb (½↑), violée à 1 172, respectée à 1 171 |

Contrat ajouté par 2.5. Le test en recopie le type et passe l'entrée par une variable, pour que le build (qui
vérifie aussi les tests) reste vert et que le rouge porte sur le comportement ; l'implémentation remplace la
copie par `import type { V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server"` :

```ts
// src/lib/estimates/v3-margin-evidence-server.ts
export type V3MarginEvidence = {
  source: "authenticated_live";
  version: { id: string; tenant_id: string; project_id: string; status: string; content_revision: number; updated_at: string };
  net_ht_cents: number;      // N, égal à version.total_ht_cents
  cost_subtotal_cents: number; // Σ D (§4.5)
};
// evaluateRules({ …, v3MarginEvidence?: V3MarginEvidence | null })
```

Règle de lecture attendue pour une v3 : preuve vivante liée à l'identité et à la révision courante, sinon gel
frais (`calc_snapshot_content_revision` = `content_revision`, contexte `engine: 3`) lu par
`cost_subtotal_cents` ; marque = `computeEstimateV3NetMarginBp` (indéterminée si HT nul) ; à défaut,
« indisponible » (`metric_key: "margin_bp"` entre dans `EstimateRuleUnavailableSignal`). Les v1/v2 ne changent pas.

### 9.5 Hypothèses et risques

- **Fenêtre de politique partagée.** L'entreprise de recette est commune à tous les parcours de la campagne
  (deux workers). Pendant la fenêtre de politique 3 (trois créations, quelques secondes), une création
  concurrente d'un autre parcours, sans attente de moteur, recevrait `CONTEXT_CHANGED`. La fenêtre est donc
  minimale et refermée en `finally`. Si la campagne complète montre ce conflit, déplacer le parcours sur un
  propriétaire dédié (profil `calc-v3`, champ `login` d'une phase, comme `resume`). *Conflit observé dès la
  première exécution à deux workers (V3FC02, §10.2, C1) ; propriétaire dédié retenu, mais créé par le parcours
  lui-même, pour qu'il reste dans la campagne critique de la CI.*
- La v3 reste pleinement modifiable, gelable et duplicable **sous politique 2** : la politique ne gouverne que
  les créations (D3, I4). Le parcours l'exige.
- La duplication porte sur une v3 en revue (`in_review`) ; la duplication d'une version non brouillon est le
  chemin « nouvelle version » existant.
- La règle de marge est insérée en SQL : la création de règle n'a qu'une action serveur d'administration ; elle
  est limitée à l'affaire par `scope_type = 'client'` et `scope_id` = l'affaire (`isRuleInScope`).
- La v2 finale reçoit des réglages explicites neutres : la création canonique recopie les réglages de la
  dernière version de l'affaire (ici une v3 à 10 % de remise et TVA 10 %) ; seules les colonnes v3 doivent
  rester nulles sur la v2 (CHECK de forme §6.2).

### 9.6 Preuve rouge (17/10/2026)

**Vitest** (Windows, worktree `miaouffrage-l2-25`, commit `64ddcc95`) :
`npx vitest run --project=node src/lib/estimates/rules-engine.v3-margin.test.ts` → sortie 1, 5/5 rouges pour
la raison visée : chaque cas reçoit une violation `min_margin` « prête » à `actual_value: 0`
(« Marge previsionnelle 0,0% sous le seuil 15,0%. ») au lieu du signal indisponible ou de la marque attendue
(2 000, 1 171) : c'est F20 (`resolveEffectiveMarginBp(v3)` vaut `null`, puis `?? 0`). `npm run typecheck` :
0 erreur ; ESLint : 0.

**E2E** (WSL Ubuntu-24.04, Node 24.14.0, clone `~/miaouffrage-lot2-25` au commit `64ddcc95`, diff local vide) :

```bash
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3P01"
```

Sortie 1. En amont : pgTAP `Files=15, Tests=1328`, `PASS` ; matrice RLS passée ; build passé. Parcours :
configuration 1/1 ; `V3P01` rouge à la sonde du schéma, après une préparation réussie (affaire
`6bb302a8-…`, ancre v2 `a8f38ac7-…`, rôle « Tuyauteur » 4 000 c/h créé par l'API) :

```text
ASSERTION_FAILED: expected {"freezeV3":false,"policyTable":false,"policyEvents":false,"policyWriter":false,
"pricingStatusType":false,"missingItemColumns":["h_mo_atelier_per_unit","h_mo_chantier_per_unit",
"h_mo_per_unit","pricing_status","snapshot_gross_fo_ht_cents","snapshot_gross_ht_cents","unit_code"],
"missingVersionColumns":["commercial_rounding_cents","discount_applied_cents","gross_ht_cents",
"sale_coefficient_fo","sale_coefficient_mo"]} to equal {…tout présent…}
```

Archive : `.e2e/army/ci/2026-10-17T14-36-31-600Z-critical/` du clone WSL (manifeste : révision `64ddcc95`,
`scope: filtered-critical`, `grep: V3P01`, `workers: 2`) ; preuve `v3p-schema` :
`critical/runs/2026-10-17T14-37-38-804Z/artifacts/business/ARMY-1792247862082-510e2016-v3p-schema.json`
(SHA-256 `81f985b25ffab8e7c7d32a38f4ec3e6575bd7477f34b8b47ecc03ebcf5b18ecb`). `estimate_line_pricing_status`
est absent ici parce que M3 (2.4) n'est pas encore dans la branche : il doit être présent après M3 + M4.

Premier essai (`.e2e/army/ci/2026-10-17T14-33-43-214Z-critical/`, commit `c966d460`) : échec au **build**, pas
au parcours. Le build de production vérifie aussi les tests, et le test Vitest importait le type d'un module
absent. Corrigé par `64ddcc95` (type recopié, entrée passée par une variable) : un test rouge ne doit pas
empêcher le build dont dépend le parcours.

Au vert attendu : la même commande rejouée après M3 et M4, `V3P01` vert de bout en bout, et le Vitest 5/5.
Obtenu : §10.3 (après les corrections de sonde du §10.2).

## 10. Intégration (17/10/2026)

Tête intégrée : piste SQL (`db753d21`, `40ac4c9f`, `d8c14cc6`), piste TS (`329dd9d7`, `56a0093b`), puis
l'intégration : `3bc50fbb`, `20b2d9e2`, `134054df`, `604782ed`, `32d3aa6a`, `df01c4b9` (`test`) et ce document.
**Aucun code de production n'a changé à l'intégration** (`git diff 56a0093b HEAD -- src ':!src/**/*.test.ts'` et
`git diff 40ac4c9f HEAD -- supabase/` vides) : les écarts trouvés étaient tous dans le harnais E2E ou dans des
sondes du parcours rouge. Aucun défaut de comportement, donc aucun nouveau test rouge.

### 10.1 Rapprochement des deux interfaces (§7.1 contre §8)

| Point | M4 | TS | Verdict |
|---|---|---|---|
| Création | `persist_estimate_creation_atomic`, `calc_engine_version` = moteur attendu ; liste blanche de 27 clés | charge v3 : réglages neutres, `calc_engine_version: 3`, deux coefficients (politique), six montants à 0, `p_items` `[]` ; v2 inchangée | conforme : V3P-02, V3P-03 |
| Lot | `p_version_patch` à 6 clés, `p_item_updates` sur toutes les lignes, `pu_ht_cents` nul admis, 5 clés de ligne | `batch-preparation.ts` : 6 totaux, toutes les lignes projetées, jamais `h_mo*` | conforme : S1, EUHIST, réétiquetage (C6) |
| Ligne | `atomic_create_estimate_item` : 6 clés, même pour une section | `atomic-item-creation.ts` | conforme : sections de l'oracle et d'EUHIST |
| Réglages | `p_totals` à 7 clés, projections à 6 clés dont `tax_rate_bp`, `apply_tax_rate_to_lines` | `settings-atomic.ts` | conforme : S2, S3, TVA 10 %, EUHIST |
| Gel | 9 arguments nommés ; contexte à 9 clés ; 11 clés de ligne ; 7 totaux | `v3-snapshot-server.ts` (contexte de `projectEstimateV3Snapshot`, rôles triés par `id`) | conforme : contexte et parts figées exacts |
| File, duplication | signatures inchangées | appelées telles quelles | conforme : V3P-09 (carte), V3P-10 |
| Politique | tables en lecture membres ; écrivain `service_role` seul | lecture par le client de l'utilisateur ; écrivain typé, jamais appelé (P-13) | conforme |
| Codes d'erreur | §7.1 | `ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` et `…_V3_CALCULATION_CONTEXT_CONFLICT` → 409 `CONTEXT_CHANGED` ; `…_V3_UNIT_REQUIRED`, `…_TAX_RATE_NOT_ALLOWED`, `…_LABOR_ROLE_REQUIRED`, `…_PROJECTION_MISMATCH` (gel, réglages) → 400 à leur nom ; `ESTIMATE_BATCH_PROJECTION_MISMATCH` par `batch.ts` | conforme ; les autres refus (contrat d'écrivain `0A000`, `ESTIMATE_CREATE_INVALID_INPUT`, D12 de la ligne) tombent dans le 400 générique de `mapSupabaseError` (limite, §10.4) |
| `src/types/database.ts` | 2 tables, 5 + 7 colonnes, enum de M3, `set_tenant_calc_policy`, `freeze_estimate_v3_snapshot` | présents (CRLF) ; colonnes v3 optionnelles dans `Row` | conforme ; écarts assumés : `Relationships: []` des deux tables (aucune sélection imbriquée ne les emprunte) et passerelles `estimate_v3_*_for_writer` non typées (internes) |
| Lecture canonique | taux du rôle du propriétaire ou 0 ; atelier/chantier ou nul ; drapeau `EST_031_LABOR_SPLIT` ; `contractor_role` | `buildEstimateV3Input` : taux ou nul ; `laborProduct` lit nul comme 0 (avertissement, refus nommé au gel) | mêmes montants |

Les sept décisions données à l'intégration sont tenues : R-08 par le déclencheur (§7.2, 1) ; autoliquidation
(§7.2, 2 ; `buildEstimateV3Input`) ; ligne non chiffrée à PU nul (F25-21, F25-22) ; CHECK de forme à `is not null`
(F25-06) ; colonnes de modèles en M6 ; v3 modifiable, gelable et duplicable sous politique 2, v2 dupliquée en v2
(V3P-10, V3P-12, F-SQL-11) ; métré refusé par son nom en TS (`TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED`, 409 ; sans
preuve exécutée à l'intégration, prouvé depuis la revue par V3P-17, §10.5).
L'émission reste fermée (V3FC02 vert).

### 10.2 Corrections d'intégration (harnais et sondes du parcours, rouge puis vert)

Chaque correction laisse les assertions et les valeurs attendues du §9 inchangées, sauf C5 (code HTTP). Archives du
clone WSL, sous `~/miaouffrage-lot2-25/.e2e/army/ci/`.

| Id | Commit | Ce que la sonde testait de faux | Correction | Rouge observé |
|---|---|---|---|---|
| C0 | `3bc50fbb` | Carte d'impact : le parcours n'y figurait pas (le §9 la disait absente ; elle arrive avec #28) | ajouté à `suite.journeys`, aux groupes `editor`, `affaires-list`, `affaire-hub` (C2) et à une règle `approvals-queue` (`src/app/dashboard/approvals/**`, retirée des routes non exercées) | 4 échecs de `army-impact-map.test.ts` avant l'ajout |
| C0′ | `3bc50fbb` | Fixture v3 de 2.1 (`engine-v3-support.ts`) : marge ×1,5 sans coefficients, refusée par le CHECK de forme | v3 à marge 1, coefficients 1,30 / 1,20, trois montants à 0 ; PR 2 250 c, pour que la lecture v1 vaille toujours 45,00 / 54,00 / 22,50 (`V1_AMOUNTS` garde son sens) | prévu au §7.5 ; V3FC01 et V3FC02 verts ensuite |
| C1 | `20b2d9e2` | La fenêtre de politique 3, ouverte dans l'entreprise de recette partagée par les deux workers, fait échouer toute création concurrente (§9.5) | `useDedicatedV3Owner` : inscription d'un compte jetable sur la pile possédée (clé anonyme, `enable_confirmations = false`), entreprise renommée `ARMY V3P <run>`, cookies de session remplacés dans le seul contexte du parcours | `2026-10-17T16-37-39-228Z-critical` : V3FC02 `[409,false]` sur son ancre v2, lancé à 16:39:24,487Z dans la fenêtre de V3P01 (preuve `v3p-policy-window` à 16:39:24,901Z) |
| C2 | `20b2d9e2` | `/dashboard/estimates` redirige vers `/dashboard/affaires` (`next.config.ts`) : la liste visée n'est pas atteignable | lecture dans la liste des versions du hub `/dashboard/affaires/{affaire}` (« Total HT » de la version) | même archive : `LOCATOR_NOT_FOUND`, écran `/dashboard/affaires` |
| C3 | `134054df` | Le hub ne liste les versions que si sa version courante (numéro le plus haut) a des lignes (`isAffaireFreshStartState`) ; EUHIST, créée après l'oracle, était vide | EUHIST créée avant l'oracle ; l'aide de lecture prend l'élément `li` qui porte le lien de la version, pas le bouton d'en-tête | `2026-10-17T16-46-41-886Z-critical` : délai dépassé, hub en état « Affaire neuve » |
| C4 | `134054df` | `app.open` efface l'identité de bail tenue en mémoire par `apiRequest` (l'application ne la restaure qu'au rechargement) : un réglage après navigation rencontre le bail du document précédent (`assertDraftLockOwnedByCurrentUser`, 409 « déjà verrouillée dans une autre page ») | `retakeLease` (`PATCH …/lock?force=true`) avant chaque réglage | corrigée à la lecture du code, avant exécution ; *rouge observé à la revue (§10.5) : C4 retirée localement à `a95e31ca`, `2026-10-17T18-07-50-333Z-critical`, premier réglage S2 → 409 `CONFLICT` « Cette version est déjà verrouillée dans une autre page d'édition. »* |
| C5 | `604782ed` | La route `approve` répond 201 à `submit_for_review` depuis `e3af04ee` (OpenAPI : 200 et 201) ; le parcours attendait 200 | 201 attendu ; le reste du gel inchangé | `2026-10-17T16-52-31-044Z-critical` : `[201,true]` contre `[200,true]`, gel par ailleurs exact (preuve `v3p-freeze`) |
| C6 | `32d3aa6a`, `df01c4b9` | D13 départage les ex aequo par `id` croissant ; les attendus par ligne viennent du moteur pur sur des `id` de fixture croissants de O1 à O7, mais le lot tire des `id` au hasard | après le lot (7 créations, inchangé), un lot de 7 mises à jour et d'un `reorder` donne au k-ième plus petit `id` les entrées de O_k, en k-ième position ; le premier essai par `position` était refusé (`CONFLICT`, position occupée). *Revue (§10.5) : le réétiquetage renvoie unité, Q, PR et h/u, et masquait donc une perte au lot de création ; l'état de ce lot est désormais asserté avant lui, par titre, sur les champs indépendants des ex aequo (unité, statut, Q, PR, h/u, `h_mo` dérivé, PU, taux, net = brut en S1).* | `2026-10-17T17-03-44-516Z-critical` : TVA S2 de O3 / O7 31 940 / 11 821 au lieu de 31 941 / 11 820 (total 1 381 071 identique), alors que `…16-52-31-044Z` passait la même assertion avec un autre ordre d'`id` ; `…17-08-01-804Z` : réétiquetage par `position` refusé |

Les §9.2, §9.3 et §9.5 portent ces corrections en italique, à leur place.

### 10.3 Preuves mesurées

Windows : Node 24.19.0, worktree `miaouffrage-l2-25`. WSL : Ubuntu 24.04, Node 24.14.0, Supabase CLI 2.120.0,
TesterArmy `e2e` 0.21.0, clone `~/miaouffrage-lot2-25` remis à la révision indiquée (diff local vide), au plus deux
exécutions natives possédées à la fois. Le parcours et la campagne `calc-v3` construisent dans le même clone : ils ne
tournent jamais ensemble (un premier essai simultané a échoué au build, « Another next build process is already
running », archive `2026-10-17T17-08-10-149Z-calc-v3`).

| Preuve | Commande | Résultat |
|---|---|---|
| Parcours (WSL, `df01c4b9`) | `E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3P01\|V3FC"` | sortie 0, **4/4** : setup, V3FC01, V3FC02, V3P01 (8,2 s) ; archive `.e2e/army/ci/2026-10-17T17-10-14-530Z-critical/` (manifeste : `passed`, `filtered-critical`, 2 workers, révision `df01c4b9`, diff vide, 248 migrations, confidentialité `passed` ; SHA-256 `d37ec454…80ae5`) |
| Valeurs de V3P01 (même archive, preuves `v3p-*`) | — | propriétaire dédié ; fenêtre : 409 `CONTEXT_CHANGED`, versions [1, 1], journal +1 ; S1 PU et TVA par ligne exacts, 6 905 456 / 1 381 091 / 8 286 547, hub « 69 054,56 € » ; S2 6 905 355 / 1 381 071 / 8 286 426, montant 101, `discount_bp` 0 ; S3 appliqué 690 546, 6 214 910 / 1 242 982 / 7 457 892 ; TVA 10 % sur la version et les 7 lignes, 6 214 910 / 621 491 / 6 836 401 ; EUHIST 180 / 36 / 216 puis brut 400, appliqué 40, 360 / 72 / 432, `discount_bp` 1 000 ; règle : `actualValue` 1 171, seuil 1 500, `ready`, `missing` ; soumission 201, `in_review`, gel frais (88 = 88), contexte exact (1,132624 ; 5 487 177 ; [{1 000 ; 6 214 910 ; 621 491}]), parts figées exactes ; carte « 62 149,10 € HT », « Marge 11.7 % » ; copie en brouillon v3 identique ; politique 2 : attente 3 → 409, versions [4, 4], v2 2 000 / 400 / 2 400 ; empreintes finales identiques (`v3p-final`, SHA-256 `30a929e2…5f2f`) |
| SQL et RLS (`runLocalSupabaseCi`, le moteur de `npm run db:ci:local`, rejoué en tête de chaque parcours et des empreintes) | idem | pile jetable, `db reset`, inventaire des 248 migrations conforme ; pgTAP `Files=19, Tests=1832, Result: PASS` (persistance, non chiffrées, garde 2.1, gouvernance et fonctions v3 `ok`) ; « Behavioral RLS matrix passed. » ; même compte que `npm run db:ci:local` de la piste SQL (§7.4, dont 90 assertions de persistance), SQL inchangé depuis |
| Montée de version | `npm run db:upgrade-check -- lot2-2-5` ; `… --negative-control` | piste SQL à `40ac4c9f` (§7.4) : 0 différence ; contrôle négatif en échec, 1 différence (la synthétique). Valables pour la tête : `supabase/` et `scripts/engine-v3/` inchangés depuis |
| Empreintes documentaires (WSL, `3bc50fbb`) | `npm run engine:document-fingerprints -- check` | sortie 0, 14 familles v1/v2, « Document fingerprints identical » ; pgTAP et matrice RLS passés en amont ; preuve `.e2e/engine-v3/document-fingerprints/2026-10-17T16-39-09-738Z-check/` |
| Parité TS/SQL (WSL, `3bc50fbb`) | `npm run engine:v3:parity` | **0 écart** sur 10 357 cas (graine 20261017, empreinte des cas `d28f3bf0…`, comme en 2.4), 248 migrations, contre-épreuve détectée, pile détruite : M4 ne change pas M3 ; rapport `.e2e/engine-v3/parity/2026-10-17T16-38-14-276Z-seed-20261017/report.json` |
| Parcours de 2.0 (WSL, `df01c4b9`, seul dans le clone) | `npm run e2e:army:calc-v3` | sortie 0, **37/37** comme la ligne de base (`tester-army-calc-v3.md`) et 2.4 : journeys 11, components 5, numeric 4, resume 5, access 2, offers 4, emission 6 ; valeurs exactes de la ligne de base assertées par chaque phase ; pgTAP `Files=19, Tests=1832, Result: PASS`, matrice RLS passée, 248 migrations, sources inchangées pendant la campagne, confidentialité passée ; 11 min 19 s ; archive `.e2e/army/ci/2026-10-17T17-11-47-010Z-calc-v3/` |
| Corpus figé (Windows) | `npx vitest run --project=node src/lib/estimates/engine-frozen-corpus.test.ts` | 2/2, identique |
| Carte d'impact (Windows) | `npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts` | 23/23 (4 rouges avant C0) |
| Vitest des fichiers touchés (Windows) | `npx vitest run <23 fichiers>` (tests touchés, tests colocalisés des modules touchés, lot, métré, route d'approbation, règle de lint, carte, corpus) | 23 fichiers, 332 tests verts |
| Types, lint (Windows) | `npm run typecheck` ; `npx eslint <41 fichiers .ts touchés depuis cb7a1d18> --max-warnings=0` | sortie 0 ; sortie 0 |
| OpenAPI, architecture (Windows) | `npm run validate-openapi` ; `npm run check:architecture` | « OpenAPI spec valide et synchronisee » (144 routes, 192 opérations) ; « Architecture budgets passed (1123 modules, 0 allowed runtime cycles) » |
| Migrations (Windows) | `npm run supabase:validate` ; `npm run supabase:migrations:git-guard` | « 248 files, 248 unique versions » ; garde passée |
| Fichiers moteur v1/v2 | `git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` | vide |
| Espaces et fins de ligne | `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` ; `git ls-files --eol src/types/database.ts src/lib/money.ts` | propre ; `i/crlf w/crlf` |

Parité et empreintes ont tourné à `3bc50fbb` ; ensuite seuls le parcours, son support, la carte d'impact et un
commentaire de test changent (`git diff --stat 3bc50fbb HEAD`) : elles valent pour la tête.

### 10.4 Restes et limites

- **`origin/main` a avancé** (`b91f938f` : PR #31 de 2.4 avec `71850b7c`, et #30). `git merge-tree` : fusion sans
  conflit, non faite ici (ni poussée ni PR, consigne). La CI de la PR rejouera Vitest complet et la campagne
  critique (V3P01 compris, sélectionné par la carte) sur le commit de fusion. *Fusionné à la revue (`f35616be`,
  `origin/main` à `9c426368` : #31, #32, #29), sans conflit ni migration nouvelle ; preuves de la revue sur la tête
  fusionnée (§10.5).*
- Les refus SQL que le TS ne nomme pas (contrat d'écrivain `0A000`, `ESTIMATE_CREATE_INVALID_INPUT`, D12 de la
  création d'une ligne) rendent le 400 générique de `mapSupabaseError` ; inatteignables par les chemins de 2.5, à
  nommer avec l'éditeur v3 (2.6). La projection refusée à la création rend 500 (§8.5).
- V3P01 dépend de l'inscription locale sans confirmation (`supabase/config.toml`, `enable_confirmations = false`) ;
  sinon il échoue au préalable, par une erreur nommée. Un compte jetable par exécution, détruit avec la pile.
- C4 est préventive (lue dans le code, non observée). *Observée à la revue (§10.5).*
- Restes des pistes : §7.5 (fixture 2.1, désormais alignée par C0′) et §8.5 (hub, remise en montant sans preuve
  vivante, chemins refusés jusqu'à 2.6 et 2.8).

### 10.5 Revue indépendante (17/10/2026) : constats, rouge puis vert

Deux revues en lecture seule de `f8baf852..44fd89c4` (montants contractuels et fermeture ; contrat SQL, sondes et
politique de test), onze constats. Chacun revérifié dans le code avant d'agir ; aucun n'est écarté. Les correctifs
suivent la politique de test : rouge écrit et observé d'abord (`a95e31ca`, `84c7af18`), puis le code (`3e4a38e7`,
`f1d94213`), sans toucher une assertion existante.

| Constat (gravité) | Vérification | Correctif | Rouge observé | Vert |
|---|---|---|---|---|
| `DELETE …/items` sur une v3 ne recalcule rien (majeur) | `deleteEstimateItem` n'a aucun aiguillage de moteur ; les gardes M4 ne voient que `INSERT`/`UPDATE` | refus nommé `ESTIMATE_ENGINE_UNAVAILABLE` (409) avant tout ; une v3 supprime par le lot (`op: "delete"`), qui recalcule et vérifie D12 | V3P-15 : `[200, true]`, EUHIST sans ligne mais 360 / 72 / 432 stockés | `[409, false, ESTIMATE_ENGINE_UNAVAILABLE]`, empreinte inchangée |
| Coefficients de création retirés par Zod (majeur) | `createEstimateVersionSchema` n'avait pas les deux clés | `v3SaleCoefficientFields` dans le schéma de création ; sur une v2, 400 `ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED` | V3P-13 : v3 à [1,3 ; 1,2] au lieu de [1 ; 1,5] ; v2 créée (201, +1 version) | [1 ; 1,5] ; `[400, false, ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED]`, 0 version |
| Marge v2 du hub pour une v3, « 0.0 % » (majeur) | `toAffaireHubVersionSummary` : `(margin_multiplier − 1) × 100` sans moteur | marque nette d'un gel v3 frais (`resolveV3NetMarginBp`) sinon `null` → « Indisponible » (résumé, tableau dense, aperçu de soumission) ; v3 hors de l'évolution | V3P-14 : « Marge appliquée0.0 %Coeff. 1.000Modifier la marge » | « Marge appliquéeIndisponible » |
| Copie v3 aux `id` aléatoires : ex aequo D13 perdus (majeur) | `jsonb_object_agg(id, gen_random_uuid())` ; M3 départage par `parts.key` (uuid) | M4 : `id` neufs appariés par rang (k-ième plus petit source ↔ k-ième plus petit neuf), v3 seulement ; v1/v2 inchangées | pgTAP F25-18 (8 copies de S2) : `have: ok:8\|8\|1`, `want: ok:8\|0\|0` (ordre rompu 8 fois, montants ≠ moteur 1 fois) | `ok:8\|0\|0` |
| C6 masquait V3P-04 (majeur, sonde) | le réétiquetage renvoie unité, Q, PR, h/u | état du lot de création asserté par titre avant le réétiquetage (champs indépendants des ex aequo) | — (correction de sonde ; passe dès le rouge `a95e31ca`) | identique |
| Taux hors politique sur une ligne non chiffrée bloque le gel (mineur) | contrôle TS sur toutes les lignes, SQL sur les chiffrées | filtre `pricing_status === "priced"` | V3P-16 : soumission `[400, ESTIMATE_V3_TAX_RATE_NOT_ALLOWED]`, gel non frais | 201, gel frais, 8 lignes et 6 214 910 / 621 491 / 6 836 401 inchangés ; TVA par taux [{1 000 ; 6 214 910 ; 621 491}] |
| Import et création rapide sous politique 3 : `CONTEXT_CHANGED` qui boucle (mineur) | aucune attente transmise ; le refus nommé venait après la comparaison | refus nommé avant la comparaison pour toute source non vierge sous politique 3 | Vitest : `CONTEXT_CHANGED` au lieu de `ESTIMATE_ENGINE_UNAVAILABLE` | 2/2 |
| Course politique ↔ création sur les coefficients (mineur) | le TS envoyait toujours les défauts lus sans verrou | coefficients non fournis retirés de la charge ; la RPC prend ceux de la politique `FOR SHARE` (pgTAP F25-05) | Vitest : `sale_coefficient_fo` 1,3 envoyé | 2/2 |
| Métré v3 sans preuve (mineur) | aucun test ne nommait `TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED` | V3P-17 : job terminé (seule ligne écrite en SQL) puis `POST …/apply` | refus TS neutralisé localement : `[409, CONFLICT]` (contrat d'écrivain SQL) | `[409, TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED]`, empreinte inchangée |
| C4 sans rouge (mineur) | — | conservée | C4 retirée localement : premier réglage S2 → 409 `CONFLICT` (bail d'une autre page) | parcours vert avec C4 |
| Types de `set_tenant_calc_policy` (mineur) | SQL : acteur requis, taux nul = défaut | `p_actor_user_id: string`, `p_allowed_tax_rates_bp: number[] \| null` (CRLF) | typage seul | `npm run typecheck` 0 |

Choix : la duplication ne rappelle pas `estimate_v3_assert_draft` sur la copie (option de la revue) : un changement
de taux horaire du propriétaire rendrait une source valide non duplicable, et chaque écrivain d'une v3 vérifie
déjà D12 maintenant que la suppression directe est fermée. M4 n'a jamais quitté des piles jetables : corrigée en
place, empreinte du manifeste rafraîchie par `npm run supabase:manifest:add` (entrée retirée puis réajoutée).
Reste : une suppression directe par PostgREST (hors application) contourne encore le refus TS ; la ligne suivante
écrite par le lot ou le gel recalcule tout (sécurité hors périmètre). *Fermé par la revue Codex de la PR #33 (§10.6) :
refus SQL hors contrat d'écrivain, décision du propriétaire (intégrité des montants).*

Preuves (Windows : Node 24.19.0 ; WSL : clone `~/miaouffrage-lot2-25` remis à la révision, au plus deux exécutions
natives possédées) :

| Preuve | Commande | Résultat |
|---|---|---|
| Rouge E2E (WSL, `a95e31ca` + refus TS du métré neutralisé localement) | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3P01"` | sortie 1, V3P01 en échec à l'assertion finale `REVIEW_EXPECTED` seulement (V3P-04 par titre vert) ; archive `.e2e/army/ci/2026-10-17T18-05-25-078Z-critical/` (manifeste SHA-256 `bb1e8080…09c6b`) |
| Rouge C4 (WSL, `a95e31ca` + C4 retirée localement) | idem | sortie 1 au premier réglage, 409 `CONFLICT` ; `2026-10-17T18-07-50-333Z-critical/` (`b9629879…9dc0`) |
| Rouge pgTAP (WSL, `84c7af18`) | `npm run db:ci:local` | sortie 1, `Files=19, Tests=1833`, `Failed test: 91` (F25-18, seul) |
| Rouge Vitest (Windows, `a95e31ca`) | `npx vitest run --project=node src/lib/estimates/canonical-v2-creation.test.ts` | 2 échecs / 4, motifs ci-dessus |
| Vert E2E + SQL + RLS (WSL, `f1d94213`, diff vide) | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3P01\|V3FC"` | sortie 0, **4/4** (setup, V3FC01, V3FC02, V3P01) ; pgTAP `Files=19, Tests=1833, Result: PASS` ; « Behavioral RLS matrix passed. » ; 248 migrations ; archive `2026-10-17T18-11-42-350Z-critical/` (`79e52912…e541`) ; valeurs S1 à S3, TVA 10 %, EUHIST, gel, 1 171, file et copie du §10.3 inchangées |
| Montée de version (WSL, `f1d94213`) | `npm run db:upgrade-check -- lot2-2-5` | sortie 0, 4 migrations après la base peuplée, **0 différence**, contrôle négatif détecté ; `.e2e/engine-v3/upgrade-check/2026-10-17T18-11-42-308Z-lot2-2-5` |
| Vitest (Windows, `f1d94213`) | `npx vitest run <18 fichiers>` (création, hub et ses écrans, approbation, réglages, schémas, OpenAPI, Direction, mutations d'éditeur, règle v3, corpus figé, carte d'impact, garde-fous CI) | 18 fichiers, 249 tests verts |
| Types, lint, OpenAPI, architecture, migrations (Windows) | `npm run typecheck` ; `npx eslint <13 fichiers> --max-warnings=0` ; `npm run validate-openapi` ; `npm run check:architecture` ; `npm run supabase:validate` ; `npm run supabase:migrations:git-guard` | 0 ; 0 ; « valide et synchronisee » (144 routes, 192 opérations) ; 1 123 modules, 0 cycle ; 248 fichiers ; garde passée |

| Parité TS/SQL (WSL, `c9139b56`, tête fusionnée avec `71850b7c`) | `npm run engine:v3:parity` | sortie 0, **0 écart** sur 10 357 cas (graine 20261017, empreinte des cas `d28f3bf0…`), contre-épreuve détectée, pile détruite ; `.e2e/engine-v3/parity/2026-10-17T18-15-26-535Z-seed-20261017/report.json` |
| Empreintes documentaires (WSL, `c9139b56`) | `npm run engine:document-fingerprints -- check` | sortie 0, « Document fingerprints identical », 14 familles v1/v2 ; pgTAP `Files=19, Tests=1833, Result: PASS` et matrice RLS passés en amont ; `.e2e/engine-v3/document-fingerprints/2026-10-17T18-16-05-307Z-check` |

Non rejouée : la campagne `calc-v3` (37/37 à `df01c4b9`, §10.3) ; la revue ne touche aucun chemin v1/v2 de calcul
ni de document (empreintes identiques), et le hub v1/v2 rend les mêmes valeurs. La CI de la PR rejoue Vitest
complet et la campagne critique sélectionnée par la carte d'impact.

### 10.6 Revue Codex de la PR #33 (17/10/2026)

Quatre constats d'une revue automatique de la tête poussée `d5d02860`, chacun revérifié dans le code puis sur une pile
native possédée avant d'agir. Politique de test tenue : assertions écrites d'abord (`72662c74`), rouge observé là où le
défaut est réel, puis le code (`f9d5a0b5`) ; aucune assertion existante affaiblie, une seule réécrite, délibérément, au
contrat décidé par le propriétaire (F3). F1 et F2 sont des faux positifs : la revue lisait les définitions de
`20260812032857`, que M1 (`20261017113844`) a remplacées et que M4 ne touche pas ; leur couverture est ajoutée quand même,
sur des v3 nées de M4.

| Constat (gravité) | Vérification | Verdict, preuve ou correctif | Rouge observé | Vert |
|---|---|---|---|---|
| F1 (P1) : après le gel d'une v3, changer le taux horaire d'un rôle cité ou le drapeau `EST_031_LABOR_SPLIT` laisserait le marqueur égal à `content_revision` (`invalidate_estimate_v2_snapshot_context` filtrerait encore `calc_engine_version = 2`), d'où une marque v3 lue comme fraîche | La définition citée (`20260812032857:2220-2249`) est remplacée par M1 (`20261017113844:813-977`) : ses trois mises à jour filtrent par `private.calc_engine_freezes_snapshot` (moteurs 2 et 3) ; M4 ne la redéfinit pas | **Non confirmé.** pgTAP F25-23 : S1 gelé par `freeze_estimate_v3_snapshot` (frais, contexte `engine` 3) ; taux 40 → 41 €/h, drapeau inséré actif, drapeau existant basculé (inséré inactif, S1 regelé à l'identique, puis activé) : marqueur et contexte NULL, marque de la file NULL. Côté TS, `resolveV3NetMarginBp` rend `null` (« indisponible ») sur ce marqueur NULL : Vitest `R-01`, même forme (`calc_snapshot_content_revision: null`, `calc_snapshot_context: null`). F-SQL-06 de 2.1 le prouvait déjà sur une v3 de fixture | — (vert tel qu'écrit, avant tout code) | `ok:true\|3\|false`, puis `ok:null\|null\|null` ×3 et file `ok:null` ×2 ; contrôle regelé `ok:true\|3\|false`, file `ok:2054` |
| F2 (P1) : `guard_estimate_project_v2_owner_change` et `guard_labor_role_v2_owner_change` se limiteraient à `calc_engine_version = 2` ; réaffecter une affaire v3 (`assignDirectionProjectOwner`) ou déplacer un rôle cité passerait | M1 (`20261017113844:274-412`) les redéfinit avec `in (2, 3)` à chaque lecture ; M4 ne les touche pas | **Non confirmé.** pgTAP F25-24, sur les v3 créées par la RPC canonique (seules versions du projet dont les lignes citent un rôle : `3\|4`) : changement de propriétaire par l'administrateur authentifié (la mise à jour de `assignDirectionProjectOwner`) et par `postgres` → `23503 ESTIMATE_PROJECT_OWNER_LABOR_ROLE_MISMATCH` ; rôle cité déplacé ou supprimé → `23503 ESTIMATE_LABOR_ROLE_ASSIGNMENT_IN_USE` | — (vert tel qu'écrit) | les quatre refus nommés |
| F3 (P2) : une suppression directe (Data API, politique `DELETE` des opérateurs) d'une ligne d'un brouillon v3 passe et laisse brut, remise, HT, TVA et TTC stockés périmés | Confirmé : la branche `DELETE` de `guard_estimate_v2_snapshot_columns` (M4) rendait `old` sans condition ; le contrat d'écrivain (`guard_estimate_item_engine_columns`) ne voit que `INSERT`/`UPDATE` ; la politique « Users can delete draft estimate items » admet le propriétaire ou l'administrateur d'un brouillon. Le TS refusait déjà (V3P-15) ; restait la Data API (§10.5, « Reste ») | **Confirmé, corrigé** dans M4 en place (jamais appliquée hors piles jetables) : hors contrat d'écrivain de sa version, la suppression d'une ligne d'un brouillon v3 lève `0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED`. Décision et chemins admis ci-dessous ; F-SQL-10 de 2.1 (« la suppression d'une ligne v3 reste possible sans contrat ») réécrite au nouveau contrat ; motif de la liste blanche F-SQL-14 complété (`= 3`) | pgTAP F25-25 : les cinq suppressions passent, `ok:6\|6214910\|5914976` ×4 (6 lignes, HT stocké 6 214 910, Σ nets 5 914 976), section `ok:0\|6214910\|0` ; F-SQL-10 réécrite `have: ok` | `0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED` ×5 ; chemins admis inchangés : `ok:6`, `ok:true\|0\|0\|0\|0\|0`, `ok:0\|0`, `ok:0\|0`, `ok:deleted\|0\|0` ; V3P-18 |
| F4 (P2) : une v3 vierge créée dans une affaire existante reçoit `max_section_depth` 3 au lieu de la profondeur de la dernière version, contrairement à `V3_INHERITED_SETTINGS` | Confirmé, en v2 aussi : `createEstimateVersionSchema` injectait `.default(3)` (depuis UX2-022, `38a74714`) et `resolveV3VersionPayload` comme `resolveVersionPayload` étalent les réglages après l'héritage. Même chemin (`POST /api/estimates`). *Rectifié par la revue de suivi (§10.6.1) : la source DPGF liée de l'assistant passe aussi par ce schéma ; la création manuelle (`startAffaireManualEstimate`) imposait 3 dans une affaire existante, pas neuve ; l'import confirmé et les modèles n'y passent pas mais héritaient déjà de la dernière version* | **Confirmé, corrigé** pour v3 et v2 : défaut retiré du schéma ; une affaire neuve garde 3 (`DEFAULT_VERSION_SETTINGS` de la création canonique) ; OpenAPI régénéré (seul `"default": 3` disparaît) | Vitest (`canonical-v2-creation.test.ts`, chaîne de la route reproduite) : v3 `[[3,3],[3,3],[3,4]]` au lieu de `[[3,1],[3,4],[3,4]]` ; v2 `[[2,3],[2,2]]` au lieu de `[[2,1],[2,2]]` | 6/6 |

**Décision F3 (écart assumé à D2).** D2 laissait les suppressions libres : elles ne réécrivaient aucune colonne de calcul.
Depuis M4, une v3 stocke un pied (brut, remise appliquée, arrondi commercial, HT, TVA, TTC) que seul un écrivain maintient
égal à ses lignes ; une ligne retirée sans recalcul laisse des montants faux jusqu'à la prochaine écriture. Décision du
propriétaire (intégrité des montants, seule exception à « sécurité hors périmètre ») : les montants stockés d'une v3 sont
toujours ceux de ses lignes. Refusé hors contrat d'écrivain de la version : la Data API de l'opérateur, `service_role`,
`postgres`, le contrat d'une autre version, et une section qui emporte ses lignes (la cascade de `parent_id` est
immédiate : une action référentielle n'est jamais différée, même sous `DEFERRABLE INITIALLY DEFERRED`). Restent admis : la
suppression sous le contrat de la version (le lot, qui recalcule et vérifie D12, section et lignes comprises) et les
cascades d'une version ou d'une affaire supprimée (suppression directe d'un brouillon, RPC contrôlée
`bulk_delete_draft_affaires` de `DELETE /api/affaires/{id}`) : la ligne de version n'est alors plus visible de la garde,
motif déjà suivi par `private.guard_estimate_batch_scope` et `public.enforce_takeoff_item_mutation_before_apply`. Une
section vide reste libre (aucun montant). Une ligne d'une v3 non brouillon garde son refus `ESTIMATE_VERSION_READ_ONLY`,
levé avant (F-SQL-04 inchangée) ; le métré en remplacement, déjà refusé par le contrat d'écrivain, l'est au même code.

**Parcours de suppression.** Aucun parcours TesterArmy existant ne supprime une affaire ou une version (`e2e/army` : seul
PLAN01 supprime des fichiers de plans) ; il n'y a donc pas de « parcours de suppression » à sélectionner par `--grep`. La
matrice RLS comportementale (`src/lib/estimates/rls.e2e.test.ts`), rejouée par chaque `db:ci:local` et en tête de chaque
`e2e:army:local`, prouve par PostgREST la cascade de `bulk_delete_draft_affaires` et de la suppression directe d'une
affaire brouillon (v2). V3P-18, ajouté à V3P01, la prouve par la route sur une affaire qui porte des v3 chiffrées (6
versions, 20 lignes et sections avant ; 0 et 0 après, `[200, true, true]`), et prouve la suppression par le lot (EUHIST :
360 / 72 / 432 avant, ligne supprimée, `[200, true, true]`, pied 0 / 0 / 0 et brut, remise, arrondi à 0).

Preuves (Windows : Node 24.19.0, worktree `miaouffrage-l2-25` ; WSL : Ubuntu 24.04, Node 24.14.0, Supabase CLI 2.120.0,
TesterArmy `e2e` 0.21.0, clone `~/miaouffrage-lot2-25` remis à `f9d5a0b5`, diff local vide ; au plus deux exécutions
natives possédées à la fois, ports 45585 et 33485 jamais touchés, aucune Supabase partagée ; journaux hors dépôt,
`~/lot2-25-codex-logs/` du clone) :

| Preuve | Commande | Résultat |
|---|---|---|
| Itération (WSL, pile jetable possédée à `d5d02860`) | suites rejouées par fichier (`psql -f`) avant, puis après la garde corrigée | rouge : persistance 94/95 (`not ok 88`, F25-25 hors contrat), garde 2.1 59/60 (`not ok 42`, F-SQL-10 réécrite) ; F25-23, F25-24 et les chemins admis de F25-25 verts ; journaux SHA-256 `427a7a0d…28c7`, `d71f4ad8…667f` ; vert : persistance 95/95, garde 60/60, non chiffrées 3/3, gouvernance 210/210, fonctions v3 210/210 |
| Rouge Vitest (Windows, `72662c74`) | `npx vitest run --project=node src/lib/estimates/canonical-v2-creation.test.ts` | 2 échecs / 6, motifs ci-dessus ; `.e2e/lot2-2.5/codex/F4-red-vitest.log` (SHA-256 `3d94cc75…3f05`) |
| SQL et RLS (WSL, `f9d5a0b5`) | `npm run db:ci:local` | sortie 0 : pile jetable, `db reset`, inventaire des 248 migrations conforme ; pgTAP `Files=19, Tests=1837, Result: PASS` (1 833 + F25-23, F25-24, F25-25 ×2) ; « Behavioral RLS matrix passed. » ; journal SHA-256 `def21a7e…27a3` |
| Parcours (WSL, `f9d5a0b5`) | `E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3P01\|V3FC"` | sortie 0, **4/4** : setup, V3FC01, V3FC02, V3P01 (10,7 s, V3P-18 compris) ; pgTAP `Files=19, Tests=1837, Result: PASS` et matrice RLS passés en amont ; archive `.e2e/army/ci/2026-10-17T19-02-51-250Z-critical/` (manifeste : `passed`, `filtered-critical`, 2 workers, révision `f9d5a0b5`, diff vide, 248 migrations, confidentialité `passed` ; SHA-256 `70648b93…a291`) ; valeurs de V3P01 du §10.5 inchangées (`v3p-review` : `directDelete` `[409, false, ESTIMATE_ENGINE_UNAVAILABLE]`) |
| Montée de version (WSL, `f9d5a0b5`) | `npm run db:upgrade-check -- lot2-2-5` ; `… --negative-control` | sortie 0 : 244 migrations de base, fixture validée, 4 migrations du lot dont M4, **0 différence**, contrôle négatif interne détecté (`.e2e/engine-v3/upgrade-check/2026-10-17T19-06-16-559Z-lot2-2-5`) ; contrôle négatif : sortie 1 exigée, 1 différence, la synthétique (`…0112 pu_ht_cents: 1481 -> 1482`, `…/2026-10-17T19-06-48-530Z-lot2-2-5-negative-control`) |
| Vitest (Windows, `f9d5a0b5`) | `npx vitest run --project=node <7 fichiers>` (création canonique, schémas, OpenAPI, serveur d'estimation, règle v3, carte d'impact, garde-fous CI) | 7 fichiers, 147 tests verts |
| Types, lint, OpenAPI (Windows) | `npm run typecheck` ; `npx eslint src/lib/estimates/schemas.ts src/lib/estimates/canonical-v2-creation.test.ts e2e/army/local/engine-v3-persistence.e2e.ts e2e/army/local/engine-v3-persistence-support.ts --max-warnings=0` ; `npm run validate-openapi` | 0 ; 0 ; « valide et synchronisee » (144 routes, 192 opérations) |
| Migrations (Windows) | `npm run supabase:manifest:add` (entrée M4 retirée puis réajoutée) ; `npm run supabase:validate` ; `npm run supabase:migrations:git-guard` | 248 entrées ; « 248 files, 248 unique versions » ; garde : en mode local, la base résolue est `@{upstream}` (`origin/lot2/2.5-persistance-v3`, tête poussée qui contient déjà M4), qui refuse M4 modifiée (« deployed migration is immutable (M) ») ; en mode PR contre `main`, comme la CI (`MIGRATION_DIFF_MODE=pull_request MIGRATION_BASE_SHA=$(git rev-parse origin/main)`) : « passed (pull_request, 2 scoped changes) » |
| Fichiers moteur v1/v2 | `git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` | vide |
| Espaces et fins de ligne | `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` ; `git ls-files --eol src/types/database.ts` | propre ; `i/crlf w/crlf` (non touché) |

Non rejoués : parité TS/SQL, empreintes documentaires et campagne `calc-v3`. La revue ne touche ni M3, ni un calcul v1/v2,
ni un document : la garde ne change que l'admission d'une suppression, le schéma une valeur de structure (profondeur des
sections). La CI de la PR rejoue Vitest complet et la campagne critique sélectionnée par la carte d'impact.

### 10.6.1 Revue de suivi du correctif F4 (17/10/2026)

Deux constats d'une revue du correctif `f9d5a0b5`, revérifiés dans le code, puis le mécanisme sur une pile native
possédée. Rouge écrit et observé d'abord (`e8c1171f`), puis le code (`aba2a74e`). Aucune assertion existante affaiblie :
celle de `startAffaireManualEstimate` est resserrée (égalité exacte au lieu de `max_section_depth: expect.any(Number)`).

| Constat (gravité) | Vérification | Verdict, correctif | Rouge observé | Vert |
|---|---|---|---|---|
| Majeur : sans le défaut 3 du schéma, la création « source DPGF liée » de l'assistant (`POST /api/estimates`, `creation_mode=linked_dpgf_source`) dans une affaire dont la dernière version est à 1 (ou à 2 avec des sections de niveau 2) hérite d'une profondeur trop faible pour la racine d'import et ses sections : le déclencheur refuse, la création échoue (`ESTIMATE_CANONICAL_V2_PERSIST_FAILED`) | Confirmé. Le client n'envoie jamais `max_section_depth` (`client.ts`, `submitEstimateCreation.ts`) ; `createEstimate` transmet les réglages sans profondeur et `resolveVersionPayload` reprend celle de la dernière version ; `createImportItems` place la racine au niveau 1 et les sections de niveaux 1 et 2 aux niveaux 2 et 3 ; `validate_estimate_item_hierarchy_depth` refuse au-delà de la profondeur de la version. Régression de `f9d5a0b5` pour l'assistant. Même défaut, antérieur, à la même jointure : l'import confirmé dans une affaire existante (`confirmUnifiedImportFlow`, réglages sans profondeur depuis toujours) et un modèle plus profond que la dernière version. En v3, toute création non vierge est refusée avant (2.8) | **Confirmé, corrigé** à la jointure (`persistCanonicalEstimateV2`, v2 et v3). Une profondeur fournie est gardée. Sinon, la profondeur héritée (3 pour une affaire neuve) est relevée au niveau de la section la plus profonde du contenu créé, jamais abaissée. Une profondeur fournie trop faible est refusée nommée, avant toute écriture (`400 ESTIMATE_SECTION_DEPTH_TOO_SHALLOW`, documenté au 400 de `POST /api/estimates`, OpenAPI régénéré) | Vitest : import `[[2,1],[2,1],[2,4],[2,1],[2,1]]` au lieu de `[[2,3],[2,2],[2,4],[2,1],[2,3]]` (assistant à 1 avec sections de niveaux 1 et 2, à 1 avec niveau 1, affaire à 4, lignes sous la racine seule, import confirmé à 1) ; modèle à deux niveaux `[2,1]` au lieu de `[2,2]` ; profondeur 2 fournie pour un besoin de 3 : création acceptée au lieu du refus nommé | 19/19 sur les deux fichiers ; mécanisme prouvé sur pile réelle (ci-dessous) |
| Mineur : `startAffaireManualEstimate` passe encore `max_section_depth: 3` avec un titre, dans une affaire existante ; sans titre la profondeur est héritée | Confirmé, latent (aucun appelant d'écran ni d'E2E). La mention « création rapide (3 explicite, affaire neuve) » de la ligne F4 était fausse : l'action cible une affaire existante (`assertProjectAccessOrThrow`) | **Confirmé, corrigé** : champ retiré (et son import) ; le test exige `version: { title: "Base manuelle" }` exactement | `max_section_depth: 3` envoyé | vert |

**Mécanisme sur pile réelle.** WSL, pile jetable possédée (248 migrations, `supabase/` identique de `f9d5a0b5` à la
tête), arrêtée et détruite ensuite. Script hors dépôt : la fixture de `transactional-workflows.test.sql` jusqu'à la
création atomique d'une version d'affaire existante, puis quatre créations par `persist_estimate_creation_atomic` dans
cette affaire. Profondeur 1, racine et section de niveau 1 : `P0001 Profondeur de section depassee (max 1).` (ce
qu'envoyait l'assistant depuis `f9d5a0b5`). Profondeur 1, racine et sections de niveaux 1 et 2 : même refus. Profondeur 2
(besoin calculé) : créée, 3 éléments. Profondeur 3 : créée, 4 éléments. Résultat `24/24 ok` ; sortie SHA-256
`4dc164e7…e3aa`, script `2982cf37…c132` (`~/lot2-25-codex-logs/followup/`).

Preuves (Windows : Node 24.19.0, worktree `miaouffrage-l2-25` ; WSL : Ubuntu 24.04, Node 24.14.0, Supabase CLI 2.120.0,
clone `~/miaouffrage-lot2-25` remis à `db164204`, diff local vide ; au plus deux exécutions natives à la fois, ports
45585 et 33485 jamais touchés, aucune Supabase partagée) :

| Preuve | Commande | Résultat |
|---|---|---|
| Rouge Vitest (Windows, `e8c1171f`) | `npx vitest run --project=node src/lib/estimates/canonical-v2-creation.test.ts src/app/dashboard/affaires/_actions/quick-create-affaire.test.ts` | 4 échecs / 19, motifs ci-dessus ; `.e2e/lot2-2.5/codex/F4-followup-red-vitest.log` (SHA-256 `c91a321e…571e`) |
| Vert Vitest (Windows, `aba2a74e`) | même commande ; puis les 9 fichiers liés (création canonique, création rapide, import confirmé, schémas, serveur d'estimation et sa couverture, OpenAPI, carte d'impact, garde-fous CI) | 19/19 (`93bf8874…1f27`) ; 9 fichiers, 190 tests (`7e61e80b…2404`) |
| Types, lint, OpenAPI (Windows) | `npm run typecheck` ; `npx eslint <4 fichiers touchés> --max-warnings=0` ; `npm run generate-openapi` puis `npm run validate-openapi` | 0 ; 0 ; « valide et synchronisee » (144 routes, 192 opérations), seule la description du 400 de `POST /api/estimates` change |
| Parcours (WSL, `db164204`, tête fusionnée avec `origin/main` `2c2fa286`) | `E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --app-port 3157 --grep "CSV DPGF\|DPGF03\|OPTIMA\|percent-formatted\|V3P01\|V3FC\|GATE0"` | sortie 0, **13/13** (run complet 111 s) : setup, DPGF (CSV métier et opaque, importés en nouvelle version d'une affaire existante ; DPGF03), OPTIMA ×3, GATE01 à 03, V3FC01, V3FC02, V3P01 ; pgTAP `Files=19, Tests=1837, Result: PASS` et matrice RLS passés en amont ; archive `.e2e/army/ci/2026-10-17T19-46-27-962Z-critical/` (manifeste : `passed`, `filtered-critical`, 2 workers, révision `db164204`, diff vide, 248 migrations, confidentialité `passed` ; SHA-256 `ee5c9137…7e87`) |
| Migrations (Windows) | `npm run supabase:validate` ; `MIGRATION_DIFF_MODE=pull_request MIGRATION_BASE_SHA=$(git rev-parse origin/main) npm run supabase:migrations:git-guard` | « 248 files, 248 unique versions » ; « passed (pull_request, 2 scoped changes) » ; aucune migration touchée par la revue de suivi (en mode local, même refus de M4 que ci-dessus, base `@{upstream}` = `d5d02860`) |
| Fichiers moteur v1/v2, espaces | `git diff --stat origin/main...HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` ; `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` | vide ; propre (fins de ligne de `quick-create-affaire.test.ts`, mixtes, et de `registry.ts`, CRLF, conservées) |

La carte d'impact classe `canonical-v2-creation.ts` en suite complète (chargé par le setup critique) : la CI de la PR
rejoue toute la suite critique. Non rejoués en local : parité TS/SQL, empreintes documentaires, campagne `calc-v3` et
montée de version ; la revue de suivi ne touche ni SQL, ni calcul, ni document, seulement la profondeur de structure
d'une version créée.
