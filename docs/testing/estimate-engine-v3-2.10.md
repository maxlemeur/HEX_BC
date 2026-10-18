# Pilote puis bascule du moteur 3 (sous-lot 2.10b, M8)

Statut : **rouges écrits, bascule en cours** (18/10/2026). Branche `lot2/2.10b-bascule-m8`, base `origin/main`
`c4c1e854`. Elle fusionne **en dernier** du lot 2, après #45 (2.7), #57 (2.10a), 2.6b, 2.7b, 2.8b et #58 (parcours
V1 des totaux sur propriétaires dédiés) ; sa M8 sera réhorodatée à la fusion (§8). Sources : cahier de la bascule
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

**M8** (`supabase/migrations/20261018130000_estimate_engine_v3_default.sql`) remplace
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
le défaut « politique absente = 3 » est prouvé par V3S01 et par pgTAP. La mesure d'acceptation de la conception
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
| F210-11 | Défauts TS et SQL divergents | V3S01 : la création TS n'envoie pas de coefficients, la base applique les siens, l'écran montre 1,30 / 1,20 |

Parcours E2E (`e2e/army/local/engine-v3-default.e2e.ts`, propriétaires dédiés) :

- **V3S01** (rouge de M8) : propriétaire sans ligne de politique ; `POST /api/estimates` avec l'attente 3 et sans
  coefficient → 201, lecture SQL `calc_engine_version = 3`, `1.3000` / `1.2000`, totaux 0 ; tiroir de paramétrage
  « 1,30 » / « 1,20 » ; la même affaire sans attente → `409 CONTEXT_CHANGED`, une seule version ; politique et
  journal toujours vides. Seul créateur de `main` qui annonce l'attente 3 : l'API (l'assistant, l'accueil et les
  modèles l'annoncent avec #57, couverts par ses V3C01 à V3C13).
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

- **pgTAP, M8 appliquée, phase 1 en place** : `db:ci:local -- --files <7 suites> --skip-rls` sur
  `254d1342` + phase 1 + suite nouvelle + M8 : **452 tests, tous verts** (log `~/l210b-logs/db-p1-switch.log`).
  Sans la phase 1, la même M8 faisait échouer `transactional-workflows` (tests 19 à 24, `CONTEXT_CHANGED` au lieu
  de la création v2) et les autres suites à sujet v2 (journal tronqué du premier passage, `db-switch-applied.log`).
- Les rouges de M8 (suite nouvelle et V3S01 sans M8) et les preuves de la phase 2 sont ajoutés au §7 par le commit
  de la bascule.

## 7. Preuves de la bascule

À compléter par le commit de la bascule.

## 8. Fusion, application et limites

- **Fusion en dernier, réhorodatage obligatoire.** `20261018130000` est postérieur à toute migration de `main`
  (dernière : `20261018093005`) et à la M5 réhorodatée de #45 (`20261018102840`). À la fusion :
  `git fetch origin`, `git merge origin/main`, `npm run supabase:migrations:restamp --
  supabase/migrations/20261018130000_estimate_engine_v3_default.sql --dry-run` puis sans `--dry-run`
  (`supabase/README.md` §3), `supabase:validate`, `supabase:migrations:git-guard`.
- **Préalable de M8.** Si une migration fusionnée avant redéfinit `persist_estimate_creation_atomic`, le préalable
  de M8 échoue (`LOT2_2_10_M8_PREREQUISITE_MISSING`) : M8 se reconstruit alors depuis la nouvelle définition
  vivante, toujours à trois lignes près. Aucune PR ouverte du lot ne la redéfinit au 18/10/2026.
- **Gardes de #57 à mettre à jour à la fusion.** V3C11 et V3C12 (« sous une politique absente, … v2 ») attendent
  `policyBefore = null` ; depuis la phase 1, un propriétaire dédié part d'une politique 2 explicite, et depuis M8
  une politique absente vaut 3. Elles deviennent « sous une politique 2 explicite ». Le commentaire
  `signUpCreatorOwner` (« absent policy ») aussi.
- **Supabase partagé** : non appliqué, sans autorisation. Ordre : M6, M6b, M5 réhorodatée, M8 en dernier. Avant
  M8, une politique 2 explicite pour toute entreprise réelle (R12) et pour l'entreprise de la campagne
  `e2e:army:critical` partagée ; vérifier que le commit déployé sur Vercel contient le code 2.10 (sinon ses
  créations échouent fermées en `CONTEXT_CHANGED` jusqu'au déploiement manuel).
- **Usage client réel** : Q01 (trois dossiers et leurs résultats attendus), avis de l'expert-comptable sur P-06 et
  P-07, phase 0 de l'audit, et D-f/D-g (métré, structure IA en v3).
