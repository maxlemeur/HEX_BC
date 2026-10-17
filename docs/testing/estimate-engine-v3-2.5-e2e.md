# Lot 2, sous-lot 2.5 — parcours E2E et isolation des règles (rouge d'abord)

Conception : [conception-lot2-moteur-v3.md](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md),
§14 « 2.5 », D3, D4, D5, D6, D8, D12, D14, D15, §5.1 à §5.3, §6.2 à §6.5. Ce document fixe, **avant tout code
de production et avant M4**, les défaillances observables du sous-lot, le parcours TesterArmy qui les expose,
le test d'isolation des règles et le contrat d'API et d'écran qu'ils supposent. L'agent d'implémentation le
fond dans `estimate-engine-v3-2.5.md`.

Fichiers :

| Fichier | Rôle |
|---|---|
| `e2e/army/local/engine-v3-persistence.e2e.ts` | Parcours `V3P01` (sélection critique locale, motif `engine-v3-*.e2e.ts` déjà listé dans `e2e.config.ts` par 2.1 : aucun enregistrement à ajouter) |
| `e2e/army/local/engine-v3-persistence-support.ts` | Préalables SQL sur la pile possédée : sonde du schéma M4, politique par `set_tenant_calc_policy` en `service_role`, règle de marge limitée à l'affaire |
| `src/lib/estimates/rules-engine.v3-margin.test.ts` | Isolation Vitest `R-01` à `R-05` (`min_margin` sur une v3, F20, T-MARG) |

`scripts/tester-army/army-impact-map.json` n'existe pas dans cette branche (PR #28) : rien à y ajouter.

## 1. Défaillances observables et scénario qui les expose

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

## 2. Déroulé du parcours `V3P01`

Entreprise de recette : celle du lanceur `run-tester-army-ci.ts` (compte neuf, entreprise personnelle `ARMY CI …`).
Toutes les écritures métier passent par l'API de l'application dans la page connectée ; seules la politique
(aucun écrivain applicatif pendant le lot 2, P-13) et la règle de marge passent par le propriétaire natif
`postgres` de la pile possédée (`E2E_ARMY_LOCAL_DB_URL`, `E2E_ARMY_LOCAL_PSQL`), sous garde : entreprise active
nommée `ARMY…`, administrée par le compte connecté.

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
   création de l'oracle et d'EUHIST avec `expected_calc_engine_version: 3` → 201 ; politique remise à 2 dans un
   `finally` (un événement de journal de plus). Les deux v3 relues : moteur 3, coefficients [1,3 ; 1,2], marge
   `fixed` ×1, coefficient global 1, remise simple 0 et montant nul, brut, remise appliquée, arrondi commercial
   et ajustement à 0, TVA 2 000 pb, totaux [0, 0, 0].
4. **Oracle (V3P-04, V3P-05).** Verrou, une section, puis les 7 lignes en **un** `POST …/batch` validé
   (`committed: true`, aucune opération en erreur). Attendu S1 :

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
   `/dashboard/estimates`, filtrée sur l'affaire, affiche « 69 054,56 € » sur la ligne de l'oracle.
6. **Réglages (V3P-07, V3P-08)**, chacun par `PATCH /api/estimates/{id}` avec `expected_content_revision` et
   `If-Match`, révision incrémentée :
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
   `submit_for_review` (voir §3.4) → 200. Relecture : montants inchangés, `approval_status` `in_review`, gel frais
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

Origine des attendus : PU, bruts, déboursé et totaux S1 à S3 recopiés de la conception (§5.1, §5.2) ;
répartitions par ligne (plus grand reste, D13), état « TVA 10 % », marque 1 171 pb et parts figées calculés par
le moteur pur 2.4 (`computeEstimateV3Breakdown` sur `oracleInput`, `computeEstimateV3NetMarginBp`), dont les
totaux égalent la conception au centime. Tolérance : 0 c (§5.5), en base comme à l'écran.

Preuves : chaque étape écrit `recordEvidence` (`v3p-schema`, `v3p-policy-window`, `v3p-batch-*`, `v3p-s1`,
`v3p-settings-*`, `v3p-approval-summary`, `v3p-freeze`, `v3p-approval-queue`, `v3p-duplicate`,
`v3p-policy-2`, `v3p-v2-baseline`, `v3p-final`) avec attendu et obtenu, sous
`.e2e/army/critical/artifacts/business/`, archivé par le lanceur sous `.e2e/army/ci/<horodatage>-critical/`.

## 3. Contrat d'API et d'écran que l'implémentation doit tenir

### 3.1 SQL (M4, appelé par la fixture)

- `public.set_tenant_calc_policy(p_tenant_id uuid, p_new_estimate_calc_engine smallint,
  p_default_sale_coefficient_fo numeric, p_default_sale_coefficient_mo numeric, p_change_reason text, …)` :
  appel par **arguments nommés**, en `service_role` (`SET LOCAL ROLE service_role`) ; tout autre paramètre doit
  avoir une valeur par défaut (`allowed_tax_rates_bp` : `{2000,1000,550,210}`). Une écriture = un événement dans
  `tenant_calc_policy_events` (`tenant_id`).
- `public.tenant_calc_policies` : colonnes `tenant_id`, `new_estimate_calc_engine`,
  `default_sale_coefficient_fo`, `default_sale_coefficient_mo`, `allowed_tax_rates_bp`, `change_reason` (§6.3).
- `public.estimate_rules` inchangée (insertion `min_margin` / `client` / `require_approval`).
- `public.freeze_estimate_v3_snapshot` existe (la sonde ne vérifie que son nom).

### 3.2 Routes et charges utiles

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
| `POST /api/estimates/{id}/approve` | `{action: "submit_for_review", rule_ids, submission_message}` | 200 ; gel v3 avant l'ouverture du cycle (`approval-v2-snapshot.ts` aiguille vers `v3-snapshot-server.ts`) |
| `POST /api/estimates/{id}/duplicate` | — | 201 `{version_id}` ; moteur conservé quelle que soit la politique (I4) |

Les colonnes numériques (`sale_coefficient_*`, `quantity`, `h_mo*`) sont comparées après `Number()` : un
`numeric` rendu en chaîne par PostgREST passe, une valeur différente non.

### 3.3 Écrans

| Écran | Sélecteur | Attendu |
|---|---|---|
| `/dashboard/estimates/{id}/edit` (v3) | `getByText(BANNER, {exact: true})`, texte de `ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE` | Bandeau visible en 2.5 ; 2.6 remplacera cette assertion |
| `/dashboard/estimates` | `getByPlaceholder("Rechercher par projet ou client...")`, puis la ligne `tr` du lien `a[href="/dashboard/estimates/{id}"]` | « 69 054,56 € » (espaces normalisés) |
| `/dashboard/approvals` | `article` dont le `h2` vaut le nom de l'affaire | « 62 149,10 € HT » et « Marge 11.7 % » |

TVA et TTC d'une v3 ne s'affichent sur aucun écran en 2.5 (éditeur en 2.6, document en 2.7) : elles sont
assertées à l'API.

### 3.4 Sonde d'approbation hors navigateur

Le garde de la campagne critique (`restrictCriticalBrowser`) bloque tout `POST …/approve` du navigateur. Comme
la sonde d'envoi de 2.1, la soumission part du processus du parcours vers l'application possédée
(`http://localhost:<port>` seulement), avec les cookies de session de la page, et exige
`RESEND_API_KEY` vide (aucune notification ne quitte la machine). Elle ne vise que l'oracle de la recette.

## 4. Isolation Vitest des règles (`R-01` à `R-05`)

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

## 5. Hypothèses et risques

- **Fenêtre de politique partagée.** L'entreprise de recette est commune à tous les parcours de la campagne
  (deux workers). Pendant la fenêtre de politique 3 (trois créations, quelques secondes), une création
  concurrente d'un autre parcours, sans attente de moteur, recevrait `CONTEXT_CHANGED`. La fenêtre est donc
  minimale et refermée en `finally`. Si la campagne complète montre ce conflit, déplacer le parcours sur un
  propriétaire dédié (profil `calc-v3`, champ `login` d'une phase, comme `resume`).
- La v3 reste pleinement modifiable, gelable et duplicable **sous politique 2** : la politique ne gouverne que
  les créations (D3, I4). Le parcours l'exige.
- La duplication porte sur une v3 en revue (`in_review`) ; la duplication d'une version non brouillon est le
  chemin « nouvelle version » existant.
- La règle de marge est insérée en SQL : la création de règle n'a qu'une action serveur d'administration ; elle
  est limitée à l'affaire par `scope_type = 'client'` et `scope_id` = l'affaire (`isRuleInScope`).
- La v2 finale reçoit des réglages explicites neutres : la création canonique recopie les réglages de la
  dernière version de l'affaire (ici une v3 à 10 % de remise et TVA 10 %) ; seules les colonnes v3 doivent
  rester nulles sur la v2 (CHECK de forme §6.2).

## 6. Preuve rouge (17/10/2026)

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
