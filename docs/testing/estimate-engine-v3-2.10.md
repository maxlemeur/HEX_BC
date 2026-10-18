# Pilote puis bascule du moteur 3 (sous-lot 2.10b, M8)

Statut : **bascule écrite, prouvée en local, fusionnée avec `main` et réhorodatée ; en attente de la revue
interne, de D-l et de la fusion en dernier** (18/10/2026). Branche `lot2/2.10b-bascule-m8`, partie de `c4c1e854`,
`origin/main` fusionné deux fois, `51bce775` puis `f1a5a74b` (§9). Elle fusionne **en dernier** du lot 2, après #45 (2.7), #57 (2.10a), 2.6b,
2.7b, 2.8b et #58 (parcours V1 des totaux sur propriétaires dédiés) ; sa M8 est réhorodatée à chaque fusion de
`main` qui ajoute une migration (§8). Sources : cahier de la bascule
(`brief-2-10`, §0 à §10), plan vers 2.10 (§3 « 2.10b » et décisions du 18/10/2026), conception du lot 2 §6.1 (M8),
§14 « 2.10 », D3, D17, P-02, P-07, P-13, P-15, R2, R12.

Règle du sous-lot : seule la création change. Aucune version existante n'est réécrite (D17) ; M8 n'écrit aucune
ligne de politique ; `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` ne changent pas ; une
v3 n'est jamais relue comme une v1 (`CalcEngineVersion` reste `1 | 2`).

## 1. Contrat de la bascule

| Cas | Avant M8 | Après M8 |
|---|---|---|
| Entreprise **sans ligne** de politique, attente 3 | `409 CONTEXT_CHANGED`, rien d'écrit | **v3**, coefficients de vente **1,30 / 1,20** (P-02), taux 20 / 10 / 5,5 / 2,1 % (P-07) ; aucune ligne de politique écrite |
| Sans ligne, attente absente (ancien client) ou 2 | v2 | `409 CONTEXT_CHANGED` (40001 `ESTIMATE_CALC_POLICY_CONTEXT_CHANGED`), rien d'écrit (D3 : attente absente = 2, échec fermé) |
| Ligne de politique **2 explicite** | v2 | **v2** (retrait par entreprise et levier de retour arrière, écrit par l'équipe) |
| Ligne de politique 3 | v3 aux coefficients de la ligne | inchangé |
| Duplication | moteur de la source | inchangé (`duplicate_source` / `duplicate_source_v3`, ne lit pas la politique) |
| Versions et lignes existantes | — | inchangées (aucune `UPDATE`, D17, P-15) |

**M8** (`supabase/migrations/20261018180027_estimate_engine_v3_default.sql`) remplace
`persist_estimate_creation_atomic` par sa **définition vivante** (M6b, `20261018013249`), à **trois lignes près** :
moteur d'une politique absente `coalesce(policy_row.new_estimate_calc_engine, 3)` ; replis `1.3000` et `1.2000`
des coefficients FO et MO d'une v3 (sans eux, une v3 sous politique absente violerait
`estimate_versions_engine_v3_shape_check`). L'attente absente reste 2. Préalable : le `md5` du `prosrc` vivant
doit être celui de M6b (`6243492d…`), sinon `LOT2_2_10_M8_PREREQUISITE_MISSING` ; contrôle final : `md5` du
nouveau corps (sinon `LOT2_2_10_M8_DEFINITION_MISMATCH`). Inchangés : défaut de la colonne
`tenant_calc_policies.new_estimate_calc_engine` (2 ; 3 violerait `tenant_calc_policies_v3_requires_defaults`),
`set_tenant_calc_policy` (`service_role` seul, P-13), propriétaire et ACL (`CREATE OR REPLACE`), repli des taux du
gel v3. Seul le commentaire de `tenant_calc_policies` est mis à jour.

**TS**, dans le même commit : `ABSENT_TENANT_CALC_POLICY = {3, 1,30, 1,20, [2000, 1000, 550, 210]}`
(`calc-policy-server.ts`, seul défaut TS, égal aux replis de M8) ; `NEW_ESTIMATE_CALC_ENGINE_VERSION = 3`, typé
`EstimateEngineVersion` ; la préparation v2 garde sa propre constante 2 (`CANONICAL_V2_CALC_ENGINE_VERSION`,
même nom et même place que dans #57). `resolveNewEstimateEngine` garde l'attente absente = 2.

## 2. Décisions et approbation consignées (D-j)

**M8 est approuvée par le porteur le 18/10/2026** (rapportée par le coordinateur ; consignée ici). Cette
approbation ne vaut ni application au Supabase partagé ni déploiement : chacun reste une autorisation explicite
distincte (§8).

Décisions du 18/10/2026, prises par le coordinateur sous délégation explicite du porteur (« décide pour moi pour
le reste ») :

| Id | Décision | Livrée par |
|---|---|---|
| D-a | Exports CSV et BDC d'une v3 livrés avant M8 | 2.7b |
| D-b | Conversion ligne ↔ section sur une v3 désactivée avec un motif nommé (interface et refus serveur) ; conversion par l'écrivain de lot plus tard | 2.8b |
| D-c | Branche v3 complète de l'éditeur mobile (`unit_code` du référentiel, h/u) | 2.6b |
| D-d | Évolution de la marge du hub : avis « indisponible pour le moteur 3 » ; série v3 tirée des gels frais plus tard | 2.10a (#57) |
| D-e | Copie d'une section v3 vers une v1/v2 : refus nommé | 2.8b |
| D-f, D-g | Métré (P-19), structure IA et version zéro (P-14) refusés sur une v3 avec motif nommé dès le lancement ; leur ouverture en v3 est un préalable de l'usage client réel, pas de M8 sur la base de développement | 2.10a (#57) |
| D-h | Modèle v2 instancié en v3 : réglages non représentables non repris et listés à l'utilisateur | 2.10a (#57) |
| D-i | Parcours dont le sujet est v1/v2 : propriétaires dédiés en politique 2 explicite | ce sous-lot (§4) |
| D-j | L'approbation de M8 du 18/10/2026 est consignée dans cette fiche | ce paragraphe |
| D-k | Dégradés acceptés pour le pilote et notés : journal des versions sans changement d'unité, explication des écarts sans coefficients de vente, montants stockés des autres brouillons v3 après un changement de taux horaire (le gel recalcule), marge du hub « indisponible » | — |

**D-l, proposé au porteur (écart de conception, à ratifier avant la fusion).** Le pilote A (§5) montre que la
campagne Army entière est une campagne v1/v2 : 91 parcours sur 176 échouent dès leur première création sous une
politique 3. Les convertir au moteur 3 dépasse ce sous-lot. Repli prévu par le cahier (§6) : l'entreprise de
recette de la campagne est provisionnée en **politique 2 explicite** par le lanceur (comme les propriétaires
dédiés, D-i) ; les parcours v3 tournent sur leurs propriétaires dédiés (politique 3 posée par l'unique écrivain) ;
le défaut « politique absente = 3 » est prouvé par V3S01, V3S01b et pgTAP. La mesure d'acceptation de la conception
« 100 % des créations du parcours en v3 » n'est donc pas atteinte par la campagne ; le pilote B
(`--tenant-calc-engine absent`) la mesurera quand les parcours v1/v2 auront été épinglés un à un ou convertis.

## 3. Défaillances observables et scénarios (écrits avant M8)

| # | Défaillance | Preuve |
|---|---|---|
| F210-01 | Sans ligne de politique, une création qui attend 3 est refusée (absente = 2), crée une v3 sans les coefficients 1,30 / 1,20, ou écrit une ligne de politique | pgTAP `estimate-engine-v3-default` ; E2E V3S01 (lecture SQL + tiroir de paramétrage) |
| F210-02 | Sans ligne, un ancien client (attente absente) crée une v2 ou une v3 au lieu de `CONTEXT_CHANGED` sans rien écrire | pgTAP ; V3S01 |
| F210-03 | Sans ligne, une attente 2 reçoit une v3 en silence | pgTAP |
| F210-04 | Une ligne de politique 2 explicite est ignorée : la création devient une v3 | pgTAP ; parcours v1/v2 de la campagne (§4) |
| F210-05 | Sous une ligne 2, une attente 3 crée une v3 | pgTAP |
| F210-06 | Une ligne 3 perd ses coefficients au profit des défauts | pgTAP |
| F210-07 | Une v2 dupliquée devient une v3, change de montant, ou sa source change | pgTAP ; E2E V3S02 (garde, verte avant M8) |
| F210-08 | Une version, une ligne ou une ligne de politique existante est réécrite | pgTAP (`to_jsonb` avant/après) ; contrôle de montée de version et empreintes par moteur (§7) |
| F210-09 | M8 remplit la politique (ligne écrite), ou change le défaut de colonne | pgTAP ; V3S01 |
| F210-10 | M8 est copiée d'une définition périmée (elle écraserait M6b) ou horodatée avant une migration de `main` | préalable `md5` de M8 ; `supabase:migrations:git-guard` |
| F210-11 | Défauts TS et SQL divergents | V3S01 couvre le repli SQL (l'API sans coefficients : la base applique les siens) ; V3S01b couvre le défaut TS `ABSENT_TENANT_CALC_POLICY` (l'assistant propose 1,30 / 1,20, envoie 1.3 / 1.2, la base enregistre une v3 à 1.3000 / 1.2000). L'import et les modèles lisent le même défaut par `readTenantCalcPolicy` ; aucun parcours ne les exerce sans ligne de politique |

Parcours E2E (`e2e/army/local/engine-v3-default.e2e.ts`, propriétaires dédiés) :

- **V3S01** (rouge de M8) : propriétaire sans ligne de politique ; `POST /api/estimates` avec l'attente 3 et sans
  coefficient → 201, lecture SQL `calc_engine_version = 3`, `1.3000` / `1.2000`, totaux 0 ; tiroir de paramétrage
  « 1,30 » / « 1,20 » ; la même affaire sans attente → `409 CONTEXT_CHANGED`, une seule version ; politique et
  journal toujours vides. Depuis #57, l'assistant, l'accueil, les modèles et l'import annoncent aussi l'attente de
  la politique (V3C01 à V3C13, sous une politique 3 posée).
- **V3S01b** (revue, ajouté après M8, F210-11) : propriétaire sans ligne de politique ; l'assistant (affaire
  vierge, « Créer le chiffrage ») : l'étape de prix propose « 1,30 » / « 1,20 » sans marge ni tranche, la requête
  envoie l'attente 3 et 1.3 / 1.2, la lecture SQL trouve une v3 à `1.3000` / `1.2000`, totaux 0 ; politique et
  journal toujours vides.
- **V3S02** (garde) : propriétaire en politique 2 explicite ; v2 d'une ligne (2 × 10,00 €, 2 000 / 400 / 2 400) ;
  politique 3 posée par `set_tenant_calc_policy` ; « Dupliquer » depuis la fiche → la copie est une v2 aux mêmes
  montants, sans coefficients, et l'empreinte de la source (statut, révision, totaux, colonnes de montant des
  lignes) est inchangée ; la duplication n'écrit aucune politique.

## 4. Phase 1 : fixtures v1/v2 épinglées (aucun changement de comportement)

Avant M8, une ligne de politique 2 explicite se comporte exactement comme une politique absente.

- **pgTAP** (sujet v2) : `estimate-calc-engine-governance` (toutes ses entreprises), `transactional-workflows`
  (rédacteur et lecteur), `estimate-calc-engine-v3-guards` (F-SQL-02, politique 2 dans la sonde),
  `estimate-creation-atomic-item-effects` (cas v2, puis politique 3 pour son cas v3), et le témoin v2 de F25-01
  dans `estimate-engine-v3-persistence` (ligne posée puis retirée par `postgres`, sans événement, pour que F25-03
  journalise toujours le premier changement). `estimate-engine-v3-nonpriced` pose déjà sa politique 3 :
  inchangé. Trouvés en exécutant les suites avec M8 appliquée (§6).
- **Vitest** : bouchons de `canonical-v2-creation.test.ts` et `import-flow.test.ts` en politique 2 explicite.
- **Propriétaires dédiés** (`dedicated-owner.ts`) : politique 2 explicite par défaut, posée par
  `set_tenant_calc_policy` en `service_role` ; `calcPolicy: "absent"` garde une entreprise sans ligne (V3S01).
  Couvre sans les modifier V3P01, V3E, IO (politique 3 ouverte puis refermée à 2), LOCK01, BES et les parcours
  V1BT/V1PT déplacés par #58.
- **Acteurs calc-v3** (`calc-v3-fixtures.ts`) et **entreprise de recette du lanceur**
  (`run-tester-army-ci.ts`) : politique 2 explicite (D-l). Le pilote passe `--tenant-calc-engine 3` (politique 3)
  ou `--tenant-calc-engine absent` (aucune ligne) ; la valeur est inscrite dans `manifest.fixtures.tenantCalcPolicy`.

## 5. Pilote A (politique 3, sans M8)

Commande (WSL, clone Linux, pile possédée) : `npm run e2e:army:ci -- full --tenant-calc-engine 3 --app-port 3191`.
Révision `254d1342` (origin/main + option du lanceur), aucune modification locale (`diffSha256` du vide), Node
24.19.0, 2 workers. Preuve : `.e2e/army/ci/2026-10-18T14-39-21-326Z-full` (clone WSL `~/miaouffrage-l2-210b`).
Entreprise de recette `fef93b6c-…`, politique avant « absente », après moteur 3, 1,3000 / 1,2000, quatre taux,
motif « ARMY 2.10b pilot … », écrivain `set_tenant_calc_policy` en `service_role`. pgTAP et matrice RLS verts.

Résultat : **85 réussis, 91 échoués sur 176** (phase full 84/172, phase development 1/4), en 473 s. Les deux
premiers lancements (13:01 et 14:38 UTC) ont été interrompus (session arrêtée, puis conflit de port avec une
boucle de développement d'un autre sous-lot) ; ils ne comptent pas.

Tous les échecs ont lieu **à la première création d'un devis**, réponse 409 ; les 17 parcours qui enregistrent le
corps montrent `CONTEXT_CHANGED`. Aucun échec après une création réussie, aucun défaut réel trouvé. Les 85
réussites comprennent tous les parcours du moteur 3 (V3E, V3P01, IO, propriétaires dédiés) et les parcours sans
création.

| Parcours en échec | Échecs | Cause | Tri |
|---|---|---|---|
| Assistant (`createEstimateViaWizard`) : `bulk-edit-sync`, `bulk-move`, `commercial-rounding`, `dpgf-import`, `estimate-integrity`, `hub-*`, `import-optima-v2`, `numeric-entry`, `numeric-entry-v3`, `plan-center`, `stale-save`, `extended/personal-columns`, `extended/settings-contracts`, `takeoff/cockpit-command-bar`, `contracts`, `generated-review`, `import-flow-carry-over`, `team-b-user-stories` (10 sur 11) | 59 | l'assistant n'annonce aucune attente (N1) | lacune corrigée par **#57 (2.10a)** ; même après #57, leur sujet reste v1/v2 (marge, paliers, arrondi v2, montants v2, métré refusé en v3 par P-19) : **hypothèse de test**, entreprise de recette en politique 2 (D-l) |
| API sans attente (`POST /api/estimates`) : `team-a-hub`, `development/team-a-hub`, `engine-v3-fail-closed` (ancre v2), `estimate-create-calculation-gate`, `tech-debt-lock-boundaries`, `extended/catalogue-connected`, `extended/settings-connected`, `takeoff/affaire-*`, `takeoff/takeoff-dpgf-review`, `team-b-user-stories` (US-4.4) | 28 | attente absente = 2, échec fermé voulu (D3) ; aucun sous-lot ne le change | **hypothèse de test** : création d'une v1/v2 (ou d'une ancre v2), épinglée en politique 2 (D-l) |
| `bulk-actions-v1-totals`, `supplier-preselection-v1-totals` | 4 | ancre v2 par l'API dans l'entreprise de recette | **hypothèse de test** ; #58 les déplace sur des propriétaires dédiés, que la phase 1 met en politique 2 sans toucher ces fichiers |

Le détail par parcours (statut et première erreur) est conservé avec la preuve ; aucun parcours n'a été relancé.

## 6. Rouges conservés

Commandes dans WSL, clone Linux, pile possédée, Node 24.19.0 ; journaux sous `~/l210b-logs/` du clone WSL.

- **pgTAP, phase 1 sans M8** (`db:ci:local -- --files <7 suites> --skip-rls`, `a036851f` + suite nouvelle,
  `db-p1-noswitch.log`) : seule `estimate-engine-v3-default` échoue, **5 sur 23**, chacun sur son motif :
  F210-01 (création attente 3 refusée, puis aucune v3 à 1,30 / 1,20), F210-02 et F210-03 (l'ancien client et
  l'attente 2 créent une v2), décompte des versions (2 au lieu de 1). Les six autres suites, épinglées, sont
  vertes sans M8 : la phase 1 ne change rien.
- **pgTAP, phase 1 avec M8** (mêmes fichiers + M8, `db-p1-switch.log`) : **452 / 452 verts**. Sans la phase 1,
  la même M8 faisait échouer `transactional-workflows` (tests 19 à 24) et les suites à sujet v2
  (`db-switch-applied.log`, premier passage, journal tronqué).
- **Campagne pgTAP complète au commit rouge** (`c585e74a`, gate de `e2e:army:ci -- critical`) : 24 fichiers,
  1 914 tests, seuls les 5 rouges ci-dessus (preuve `.e2e/army/ci/2026-10-18T15-08-52-772Z-critical`).
- **E2E rouge** : `npm run e2e:army:ci -- critical --grep "V3S0|V3P01|V3FC0|LOCK01"` sur `c585e74a`, la suite
  pgTAP rouge mise de côté pour franchir le gate (seule modification locale, `diffSha256` `885b884b…`), 2 workers,
  407 s, preuve `.e2e/army/ci/2026-10-18T15-14-13-652Z-critical`. Entreprise de recette en **politique 2
  explicite** (`manifest.fixtures.tenantCalcPolicy`). **V3S01 rouge** sur son motif : `[409, false,
  "CONTEXT_CHANGED"]` au lieu de `[201, true, null]` (politique absente = 2) ; **V3S02 vert** (garde) ; V3FC01,
  V3FC02, V3P01 et LOCK01 verts avec les propriétaires dédiés et l'entreprise de recette en politique 2.

## 7. Preuves de la bascule (`6aa1ed31`, clone propre, `diffSha256` du vide)

| Preuve | Commande | Résultat |
|---|---|---|
| Garde Git des migrations | `supabase:migrations:git-guard -- --base c4c1e854 --mode pull_request` | vert, 2 changements |
| Historique des migrations | `supabase:validate` | 254 fichiers, 254 versions |
| SQL et RLS | `db:ci:local` | 24 fichiers, 1 914 tests verts ; matrice RLS verte (190 s) |
| M8 isolée sur base peuplée | script de preuve (pile possédée sans M8, fixture `lot2-fixture.sql` chargée, v2 et v3 créées par la RPC, M8 appliquée par psql) | voir ci-dessous |
| Critique | `e2e:army:ci -- critical` | vert : 29 fichiers, 108 / 108 (639 s, `.e2e/army/ci/2026-10-18T15-22-53-638Z-critical`) |
| Montée de version | `db:upgrade-check -- lot2-2-10` | 0 différence ; contrôle négatif détecté (`.e2e/engine-v3/upgrade-check/2026-10-18T15-33-34-225Z-lot2-2-10`) ; `--negative-control` échoue exactement sur la migration synthétique (attendu) |
| Empreintes documentaires | `engine:document-fingerprints -- check` | identiques, 14 familles (`.e2e/engine-v3/document-fingerprints/2026-10-18T15-44-59-887Z-check`) |
| Campagne complète | `e2e:army:ci -- full` | 173 / 174 + development 4 / 4 (`.e2e/army/ci/2026-10-18T15-46-59-989Z-full`) ; seul rouge : SET02 (§9, hors bascule) |
| calc-v3 | `e2e:army:calc-v3 -- --phase journeys` | toutes les phases vertes en CI sur `0cd19f9f` (§9, run 39152484822). Avant : vert (264 s, `.e2e/army/ci/2026-10-18T16-00-36-133Z-calc-v3`), avant la fusion de #45 (émission). Phase `components` interrompue à 18:07 par l'arrêt de la campagne (préparation `exit=2`, pile arrêtée) : **non prouvée** ; numeric, resume, access, offers, emission et emission-v3 non lancées. La CI de la PR **ne les exécute pas** (`e2e-army-calc-v3.yml` ne tourne sur une PR que si elle modifie ce fichier) : **préalable de fusion**, après le push, `gh workflow run e2e-army-calc-v3.yml --ref lot2/2.10b-bascule-m8 -f phase=all`, preuve consignée ici |
| Qualité | `verify:pr` (arbre de `6aa1ed31`, avant commit) | vert (167 s) |

**M8 isolée** (`~/l210b-m8proof/m8-proof.json`, sha256 `36745c20…`) :

- empreintes avant et après M8 **identiques** pour tout sauf le corps de la fonction : versions v1 : 2, v2 : 5,
  v3 : 1 (dont 2 non brouillons, scellées), lignes 5 / 12 / 2, 2 documents, 2 lignes de politique, 2 événements ;
  `md5` des lignes complètes (`to_jsonb`) et des colonnes de montant égaux par moteur ; défaut de colonne `2`,
  ACL `{postgres=X, service_role=X}` et propriétaire inchangés ;
- `prosrc` `6243492d…` (M6b) → `7167bf9a…` ; `diff` de `pg_get_functiondef` : exactement les trois lignes du
  §1 (l. 108, 574, 578) ;
- après M8 (transaction annulée) : politique absente + attente 3 → v3 à `1.3000` / `1.2000` ; politique absente
  sans attente → `40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED` ; politique 2 explicite → v2.

Appels stricts de `resolveCalcEngineVersion` (15, dans 10 fichiers) : ils lèvent `EstimateEngineUnavailableError`
sur une v3 (refus nommé), jamais une relecture en v1 ; les chemins ouverts aux v3 passent par leur branche v3
(2.5 à 2.8). Ce sous-lot n'en ouvre aucun. `estimate-calculations.ts` et `estimate-v2-snapshot.ts` : aucun
changement (`git diff --stat` vide) ; le corpus figé v1/v2 est rejoué par `verify:pr`.

## 8. Fusion, application et limites

- **Fusion en dernier, réhorodatage obligatoire.** M8 a été réhorodatée le 18/10/2026 après la fusion de
  `origin/main` `51bce775` (`20261018130000` → `20261018164448`), puis après celle de `f1a5a74b` (dernière
  migration de `main` : `20261018170351`, reçus d'insertion complets) : `20261018164448` → `20261018171616`, puis après celle
  de `ab1e0ca3` (dernière migration : `20261018172935`, ordre du contrat 2, #65) : `20261018171616` → `20261018180027`
  (§9). À la fusion, si `main` a reçu une migration entre-temps :
  `git fetch origin`, `git merge origin/main`, `npm run supabase:migrations:restamp --
  supabase/migrations/20261018180027_estimate_engine_v3_default.sql --dry-run` puis sans `--dry-run`
  (`supabase/README.md` §3), `supabase:validate`, `supabase:migrations:git-guard`.
- **Préalable de M8.** Si une migration fusionnée avant redéfinit `persist_estimate_creation_atomic`, le préalable
  de M8 échoue (`LOT2_2_10_M8_PREREQUISITE_MISSING`) : M8 se reconstruit alors depuis la nouvelle définition
  vivante, toujours à trois lignes près. Aucune PR ouverte du lot ne la redéfinit au 18/10/2026.
- **Gardes de #57** : V3C11 et V3C12 tournent désormais « sous une politique 2 explicite » (§9).
- **Supabase partagé : M8 exclue de l'autorisation permanente.** Le porteur autorise d'appliquer les migrations
  du lot 2 après la fusion de leur PR, « Ni politique de calcul ni déploiement »
  (`docs/testing/shared-supabase-m5-2026-10-18.md`, utilisée pour M5 puis `20261018170351`). M8 ne relève pas de cette autorisation et demande une
  décision propre du porteur : appliquée seule, elle fait passer au moteur 3 toute entreprise sans ligne de
  politique (toutes, puisque l'autorisation interdit d'en écrire), et chaque création y échoue en
  `409 CONTEXT_CHANGED` (sans écriture) tant que le code déployé ne la suit pas. Les deux sens échouent : un
  commit qui contient 2.10a sans `6aa1ed31` (défaut TS « absente = 2 ») contre une base avec M8, et un commit
  qui contient `6aa1ed31` (défaut TS « absente = 3 ») contre une base sans M8.
- **État et ordre.** Déjà appliquées au Supabase partagé : M6, M6b, M5, M7 et `20261018170351` ;
  `20261018172935` (#65, ordre du contrat 2) relève de l'autorisation permanente et précède M8, qui vient
  ensuite. Deux ordres sûrs, chacun sur autorisation distincte :
  1. écrire d'abord une politique 2 explicite pour chaque entreprise du Supabase partagé, dont l'entreprise de la
     campagne `e2e:army:critical` partagée (écriture de politique, R12), puis M8 et le déploiement dans
     n'importe quel ordre : rien ne change pour elles tant que l'équipe ne les passe pas à 3 ;
  2. ou appliquer M8 puis déployer aussitôt (Vercel, manuel) un commit qui contient `6aa1ed31`, en acceptant
     la fenêtre de 409 entre les deux.
- **Usage client réel** : Q01 (trois dossiers et leurs résultats attendus), avis de l'expert-comptable sur P-06 et
  P-07, phase 0 de l'audit, et D-f/D-g (métré, structure IA en v3).

## 9. Fusion de `main` (18/10/2026)

`git merge origin/main` (`51bce775` : #45 2.7, #57 2.10a, #58 V1 des totaux, #63), commit `601ddbee`. Conflits
gardant les deux intentions : carte d'impact (`engine-v3-default` à côté des parcours créateurs, émission, exports
et V1 des totaux, sans toucher leurs propriétaires) et manifeste des migrations (M5 puis M8). Aucune migration de
`main` ne redéfinit `persist_estimate_creation_atomic` : le préalable `md5` de M8 (M6b) tient.

- **Réhorodatage** (`1e3a822a`) : `supabase:migrations:restamp` contre `51bce775`, `20261018130000` →
  `20261018164448`, clé du manifeste renommée, sha256 inchangé ; garde Git et validation du manifeste vertes.
- **Hypothèses de test de #57 mises à jour** (`e9c0ac6c`), rouges sur la tête fusionnée avant correction :
  - Vitest `quick-create-affaire.test.ts` : **5 / 5 rouges** (les créations v2 bouchonnées sans ligne de
    politique envoyaient l'attente 3) ; bouchon en politique 2 explicite, comme `canonical-v2-creation.test.ts`
    (phase 1) ;
  - V3C11 et V3C12 : `policyBefore` attendu `null` alors que le propriétaire dédié porte la politique 2
    explicite depuis la phase 1 ; ils attendent cette ligne avant et inchangée après. Aucune assertion de
    montant ni de moteur n'est modifiée ;
  - commentaires « politique absente = 2 » corrigés (`HISTORICAL_CREATION_ENGINE`, conception §6.3).
- **OpenAPI** (`8995bc12`) : la fusion réutilise le schéma de l'attente de moteur sur une opération de plus ; le
  contrôle OpenAPI du build de production a refusé l'artefact périmé (premier passage critique ciblé
  `.e2e/army/ci/2026-10-18T16-47-37-170Z-critical`, phase build, après pgTAP et matrice RLS verts sur `e9c0ac6c`).
  Régénéré par `scripts/validate-openapi.ts --write` : une ligne de description.
- **Observation hors bascule** : SET02 (`extended/settings-contracts`, campagne complète du §7) échoue sur
  `estimate-editor-settings-button` « outside of the viewport » dans un devis v2 de l'entreprise de recette en
  politique 2 : chemin de création et de calcul inchangé par M8. Non relancé ; à trier par son propriétaire.

**Seconde fusion** (`eb4bc10d`, `origin/main` `f1a5a74b` : lectures complètes PostgREST, migration
`20261018170351_complete_estimate_insertion_receipts`, qui ne redéfinit pas `persist_estimate_creation_atomic`) :
seul conflit, le manifeste (les deux entrées gardées) ; M8 réhorodatée `20261018164448` → `20261018171616`
contre `f1a5a74b` (garde Git et validation du manifeste vertes). Les preuves ci-dessous sont rejouées sur la
tête de la seconde fusion quand elle les invalide (dernière ligne).

| Preuve sur la tête fusionnée | Commande | Résultat |
|---|---|---|
| Garde Git des migrations | `supabase:migrations:git-guard -- --base 51bce775 --mode pull_request` (`e9c0ac6c`) | vert |
| Historique des migrations | `supabase:validate` (`e9c0ac6c`) | vert |
| SQL, RLS et parcours touchés | `e2e:army:ci -- critical --grep "V3S0\|V3C11\|V3C12"` (`8995bc12`, `diffSha256` du vide, 2 workers, 379 s) | pgTAP **25 fichiers, 1 964 tests verts** (dont `estimate-offer-contract-v2` de #45) ; matrice RLS verte ; V3S01, V3S02, V3C11, V3C12 verts (5 / 5 avec l'authentification) ; preuve `.e2e/army/ci/2026-10-18T17-06-39-916Z-critical` |
| Seconde fusion : garde Git, historique, SQL, RLS et parcours touchés | `git-guard -- --base f1a5a74b`, `supabase:validate`, même `--grep` (`b03d5798`, `diffSha256` du vide, 204 s) | verts ; pgTAP **26 fichiers, 1 974 tests** (dont `complete-estimate-receipts`) ; matrice RLS verte ; 5 / 5 ; preuve `.e2e/army/ci/2026-10-18T17-16-53-959Z-critical` |

**Troisième fusion** (`3df9bc1a`, `origin/main` `ab1e0ca3` : #60 exports CSV et BDC v3, #62 limites de l'éditeur
v3, #65 impression scellée et migration `20261018172935_estimate_offer_client_contract_v2_order`, qui ne redéfinit
pas `persist_estimate_creation_atomic`) : seul conflit, le manifeste (les deux entrées gardées) ; `openapi.json`
fusionné sans conflit et validé (`validate-openapi` vert). M8 réhorodatée `20261018171616` → `20261018180027`
(`25d26721`, garde Git et validation du manifeste vertes, sha256 `0fdaba7c…` inchangé). Les parcours de #60 qui
créent une v2 sans attente (V3X01 cible d'import après `prepareV3Draft`, V3X06 dans l'entreprise de recette en
politique 2 explicite) sont rejoués avec M8 :

| Preuve sur la tête fusionnée | Commande | Résultat |
|---|---|---|
| Troisième fusion : garde Git, historique, SQL, RLS et parcours touchés | `git-guard -- --base ab1e0ca3`, `supabase:validate`, `critical --grep "V3S0\|V3C11\|V3C12\|V3X01\|V3X06"` (`25d26721`, clone propre, 2 workers, 121 s) | verts ; pgTAP **26 fichiers, 1 977 tests** (dont `estimate-offer-contract-v2` de #65) ; matrice RLS verte ; V3S01, V3S01b, V3S02, V3C11, V3C12, V3X01, V3X06 verts (8 / 8 avec l'authentification) ; preuve `.e2e/army/ci/2026-10-18T18-01-44-274Z-critical` (clone WSL) |
| calc-v3, toutes les phases (CI, `workflow_dispatch` sur la branche) | `gh workflow run e2e-army-calc-v3.yml --ref lot2/2.10b-bascule-m8 -f phase=all`, run [39152484822](https://github.com/maxlemeur/HEX_BC/actions/runs/39152484822) (`0cd19f9f`, `diffSha256` du vide) | vert : pgTAP 26 fichiers, 1 977 tests ; matrice RLS ; journeys, components, numeric, resume, access, offers, emission et emission-v3 `passed` (`calc-v3.json`, artefact `army-calc-v3-evidence`) |
| Critique non filtrée et takeoff (CI, `workflow_dispatch` sur la branche) | `gh workflow run e2e-army-critical.yml --ref lot2/2.10b-bascule-m8`, run [39152486473](https://github.com/maxlemeur/HEX_BC/actions/runs/39152486473) (`0cd19f9f`) | vert : sélection, 4 shards critiques et `army-takeoff` |

Seule la tête fusionnée et ce qu'elle change sont rejoués localement (consigne de vitesse du porteur, 18/10) : la
sélection critique non filtrée et les parcours takeoff tournent dans la CI de la PR, qui fait foi. calc-v3 n'y
tourne pas : son dispatch manuel (§7) est un préalable de fusion ; il est vert sur `0cd19f9f` (ligne ci-dessus), et
les phases qu'invalide la fusion de #59 sont rejouées sur la tête finale.
`verify:pr` est lancé une fois sur la tête finale (résultat dans le corps de la PR).

## 10. Revue interne avant le premier push (18/10/2026)

Revue en lecture seule de `254d1342..be7f443d` : contrat M8 et code conformes (corps de M8 = M6b à trois lignes
près, absente = 2 côté attente, politique 2 explicite → v2, duplication sans lecture de politique, fichiers
protégés sans diff). Quatre défauts de procédure ou de documentation, corrigés :

| Constat | Correction |
|---|---|
| §8 laissait M8 sous l'autorisation permanente, dans un ordre périmé, avec une condition de déploiement fausse (« code 2.10 ») | §8 : M8 exclue de l'autorisation, état appliqué jusqu'à `20261018170351`, deux ordres sûrs, condition exacte `6aa1ed31` |
| calc-v3 annoncé comme exécuté par la CI de la PR | §7 et §9 corrigés : dispatch manuel `-f phase=all` après le push, préalable de fusion |
| F210-11 sans preuve : V3S01 n'exerce que le repli SQL | V3S01b (`a17c1c28`) : l'assistant sans ligne de politique propose 1,30 / 1,20, envoie 1.3 / 1.2, la base enregistre une v3 à 1.3000 / 1.2000 |
| `e9c0ac6c` réécrivait les fins de ligne CRLF de `quick-create-affaire.test.ts` (#57) | `5c569a07` : octets de `main` restaurés, seul le changement de politique 2 reste (16+ / 4−), `git diff --check` propre |

Preuve de V3S01b : `e2e:army:ci -- critical --grep "V3S0"` sur `a17c1c28` (`diffSha256` du vide, 2 workers, 95 s) :
pgTAP 26 fichiers, 1 974 tests ; matrice RLS verte ; V3S01, V3S01b, V3S02 verts (4 / 4 avec l'authentification) ;
valeurs attendues et lues identiques dans `v3s01b-offered` et `v3s01b-created` ; preuve
`.e2e/army/ci/2026-10-18T17-38-52-915Z-critical` (clone WSL). V3S01b couvre une garantie déjà livrée par
`6aa1ed31` : il est vert dès son ajout, sans rouge préalable (aucun changement de comportement).
