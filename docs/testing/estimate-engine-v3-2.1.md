# Socle fermé par défaut du moteur v3 (sous-lot 2.1)

Statut : **implémenté, vérifié en local** (17/10/2026). Les tests rouges (commits `test(lot2-2.1)` sur
`lot2/2.1-socle-ferme`, base `141218a9`) ont été écrits avant le code ; la migration M1 et le code TS
(commits `feat(lot2-2.1)`) les font passer sans en modifier les assertions. Voir
[Implémentation](#implémentation-17102026) pour les écarts d'implémentation et les preuves, et
[Vérification](#vérification-17102026) pour la contre-épreuve sur le commit final. Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), D1, D2,
§6.4, §7, §8, §9 et §14 « 2.1 ».

Objet du sous-lot : admettre la valeur 3 en base et, dans la même migration, fermer toutes les
portes. À la fin de 2.1, aucune version 3 ne peut être créée par l'application ; une v3 insérée
par `postgres` (seul chemin, fixture) n'est jamais relue comme une v1, n'est jamais émise et
n'est écrite que par un écrivain adapté, qui n'existe pas encore.

## Contrat défini avant l'implémentation

SQL (M1, `…_estimate_calc_engine_v3_fail_closed.sql`, horodatée après la dernière migration de
`main`) :

| Élément | Comportement exigé |
|---|---|
| `estimate_versions_calc_engine_version_check` | `CHECK ((calc_engine_version = ANY (ARRAY[1, 2, 3])))` ; 4 refusé |
| `enforce_estimate_calc_engine_on_insert` | admet 1 à 3 (`23514 ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED` sinon) ; `canonical_v2` → 2 et `legacy_v1` → 1 même si 3 est demandé ; `duplicate_source` avec 3 → `0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED` ; seule une insertion sans contrat par `postgres` crée une v3 |
| `private.calc_engine_freezes_snapshot(smallint)` | vrai pour 2 et 3, faux pour 1 ; remplace `= 2` dans les gardes héritées (`guard_estimate_v2_snapshot_columns`, `guard_estimate_project_v2_owner_change`, `guard_labor_role_v2_owner_change`, `open_estimate_review_cycle`, `capture_estimate_review_content_revision`, `invalidate_estimate_v2_snapshot_context`, `require_fresh_v2_snapshot_for_publication`) |
| Contrat d'écrivain v3 | `public.guard_estimate_item_engine_columns()` (lignes) et `public.guard_estimate_version_engine_v3_writer()` (versions) : sur une v3, toute insertion de ligne et toute écriture d'une colonne de calcul exigent `miaouffrage.estimate_v3_writer = <id de version>`, sinon `0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED`. Libres : `title`, `position`, `aid`, `parent_id`, `updated_at` des lignes ; suppression d'une ligne de brouillon ; colonnes non calculatoires de version (`title`, `validite_jours`…), statut, approbation, sceau, `content_revision`, remise à NULL du gel par l'invalidation. Le contrat ne rouvre jamais une version envoyée et ne lève aucune garde héritée (propriétaire des rôles) |
| Émission | `require_fresh_v2_snapshot_for_publication` lève `0A000 ESTIMATE_V3_EMISSION_NOT_READY` au passage d'une v3 à `sending` ou `sent`, même figée ; `public.guard_estimate_document_engine_v3()` refuse toute ligne `estimate_documents` d'une v3 avec le même code ; `estimate_offer_client_items_match` renvoie faux hors {1,2} |
| `list_approval_queue` | marge NULL pour une v3 (texte `version.calc_engine_version = 1` conservé) |
| Immutabilité | `ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE` reste le premier refus d'un changement de moteur, contrat d'écrivain compris |
| Garde `prosrc` | toute fonction `public`/`private` dont le source compare `*engine_version` à un littéral figure dans la liste blanche revue de la suite pgTAP |

TypeScript :

| Élément | Comportement exigé |
|---|---|
| `resolveCalcEngineVersion` | inchangé pour `null`, absent, 0, NaN, 1, 2 et la troncature ; 3 (3,9 compris) → `EstimateEngineUnavailableError` ; 4 et plus → code `ESTIMATE_CALC_ENGINE_UNSUPPORTED` |
| `EstimateEngineUnavailableError` (`src/lib/estimates/engine/capabilities.ts`) | `name` `EstimateEngineUnavailableError`, `code` `ESTIMATE_ENGINE_UNAVAILABLE`, `engineVersion` 3, `status` 409, message « Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action. » ; les routes répondent 409 avec ce code et ce message |
| `requireEstimateEngineVersion(row)` | `Object.hasOwn(row, "calc_engine_version")` sinon `ESTIMATE_CALC_ENGINE_MISSING` ; entier de {1,2,3} sinon `ESTIMATE_CALC_ENGINE_UNSUPPORTED` ; jamais de valeur par défaut |
| `computeVersionBreakdown` (`engine/compute.ts`) | 1 et 2 → `computeEstimateBreakdown` à l'identique ; 3 → `EstimateEngineUnavailableError` ; autre → `ESTIMATE_CALC_ENGINE_UNSUPPORTED` |
| Chemins contractuels | publication du PDF, envoi, approbation, sceau et réglages d'une v3 refusent par `EstimateEngineUnavailableError` avant tout gel, rendu, dépôt, réservation ou appel SQL ; l'envoi refuse avant même de lire sa configuration (`RESEND_API_KEY`, `EMAIL_FROM`) |
| ESLint | `no-restricted-syntax` refuse `===`, `!==`, `==`, `!=` entre 1, 2 ou 3 et `calcEngineVersion`, `engine`, `*.calc_engine_version`, `*.calcEngineVersion` ou `resolveCalcEngineVersion(…)`, dans `src/**` et dans le bloc `src/app/api/**` ; exemptés : `calc-engine-version.ts`, `engine/**`, `engine-v3/**`, `estimate-calculations.ts`, `estimate-v2-snapshot.ts` et les fichiers `*.test.ts(x)` ; un `switch` reste permis |
| Interface | l'éditeur (`[versionId]/edit`) et la fiche (`[versionId]`) d'une v3 affichent le bandeau ci-dessus et aucun montant calculé en v1 ; les ouvrir n'écrit rien |

`src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent à zéro ligne de
diff. M1 n'ajoute aucune colonne : `upgrade_check.declared_new_columns()` ne change pas et le test
de montée de version doit rester à 0 différence.

## Défaillances observables et preuves

SQL : `supabase/tests/database/estimate-calc-engine-v3-guards.test.sql` (60 assertions) et la
réécriture délibérée de `estimate-calc-engine-governance.test.sql`.

| Id | Défaillance | Preuve (assertions) |
|---|---|---|
| F-SQL-01 | Le CHECK admet 4, ou refuse encore 3 | définition exacte du CHECK ; insertion du moteur 4 refusée |
| F-SQL-02 | Une v3 naît d'un contrat d'insertion (duplication, création canonique, appel direct) ou change de moteur | `canonical_v2` → 2, `legacy_v1` → 1, `duplicate_source` refusé, RPC de création à 3 refusée, insertion `authenticated` interdite, insertion `postgres` sans contrat admise ; moteur immuable, contrat compris |
| F-SQL-03 | Le prédicat d'héritage manque ou se trompe | `{f,t,t}` pour 1, 2, 3 |
| F-SQL-04 | Une ligne de v3 envoyée change | titre, suppression, quantité sous contrat : `ESTIMATE_VERSION_READ_ONLY` |
| F-SQL-05 | Rôles MO incohérents avec le propriétaire | changement de propriétaire, réaffectation et suppression d'un rôle utilisé, ligne au rôle d'un autre propriétaire (sous contrat) ; et, dans la suite de gouvernance, les trois mêmes refus sur un projet qui ne contient qu'une v3 (remplace la recherche de texte `version.calc_engine_version = 2`, lignes 852 et 871) |
| F-SQL-06 | Un gel v3 reste « frais » après un changement de contexte | taux horaire et drapeau de ventilation invalident le gel |
| F-SQL-07 | Une revue s'ouvre sur une v3 sans gel frais | RPC `open_estimate_review_cycle` et insertion directe d'un cycle : `ESTIMATE_V2_SNAPSHOT_STALE` |
| F-SQL-08 | Une v3 passe à `sending` ou `sent` | brouillon non figé et brouillon figé : `ESTIMATE_V3_EMISSION_NOT_READY` |
| F-SQL-09 | Un document v3 existe ou se valide | document `processing` ou `failed` refusé ; appariement client faux même pour des lignes conformes |
| F-SQL-10 | Un écrivain non adapté écrit une v3 | insertion de ligne ou de section, écriture d'une colonne de calcul par `postgres`, `authenticated` (mise à jour directe) ou `service_role`, contrat lié à une autre version, gel par le seul marqueur v2, neuf colonnes de version ; RPC `commit_estimate_batch` (non validé, `ESTIMATE_BATCH_INVALID_INPUT`, rien d'écrit), `atomic_create_estimate_item`, `bulk_update_estimate_items`, `save_estimate_settings_atomic`, `commit_generated_ouvrages`, `finalize_estimate_assembly_calculation`, insertion d'ouvrage, métré (`apply_takeoff_job_guarded_atomic`, puis recalcul), modèle, structure IA, version zéro ; contrôles : contrat lié à la version, colonnes neutres, suppression, colonnes de version neutres, brouillon v2 non touché |
| F-SQL-11 | Une v3 se duplique | `duplicate_estimate_version` normal et variante refusés |
| F-SQL-12 | Un gel v2 s'applique à une v3 | `freeze_estimate_v2_snapshot` et `freeze_estimate_v2_document_snapshot` refusent (inchangé) |
| F-SQL-13 | La file d'approbation calcule une marge v2 pour une v3 | v3 en revue, contexte figé portant un multiplicateur v2 de 1,25 : marge NULL, pas 2 000 pb |
| F-SQL-14 | Une nouvelle comparaison littérale au moteur échappe à la revue | `prosrc` des schémas `public` et `private` contre la liste blanche ; les entrées sans comparaison sont listées en diagnostic |

TypeScript, tests d'exigence isolés (Vitest, projet `node`). Isolation justifiée par une
frontière d'intégrité ouverte : aucune v3 n'atteint ces chemins en E2E avant 2.5, et une relecture
silencieuse en v1 y produirait un montant, un sceau ou un document faux.

| Id | Défaillance | Test |
|---|---|---|
| F-TS-01 | Le résolveur lit 3 ou 4 comme 1 | `calc-engine-version.test.ts` (test `:23` réécrit, cas 4 ajouté) |
| F-TS-02 | Un chemin contractuel accepte une colonne absente ou hors domaine | `engine/capabilities.test.ts` |
| F-TS-03 | La façade calcule une v3 avec un moteur historique, ou aiguille mal 1 et 2 | `engine/compute.test.ts` |
| F-TS-04 | La publication du PDF d'une v3 réclame, fige, rend ou dépose | `pdf-generator.test.ts` |
| F-TS-05 | L'envoi d'une v3 lit sa configuration, relit, fige, contrôle, réserve ou livre | `send-estimate.test.ts` |
| F-TS-06 | L'approbation d'une v3 passe sans gel, comme une v1 | `approval-v2-snapshot.test.ts` |
| F-TS-07 | Une v3 est scellée avec une charge v1/v2 | `estimate-seal.test.ts` |
| F-TS-08 | Les réglages d'une v3 sont recalculés en v1 et envoyés | `settings-atomic.test.ts` |
| F-TS-09 | La règle ESLint ne voit pas une comparaison brute, ou bloque la liste blanche | `src/test/engine-version-lint.test.ts` (vraie configuration, sources virtuelles) |

E2E sur la pile possédée : `e2e/army/local/engine-v3-fail-closed.e2e.ts`, ajouté aux sélections
`critical` locale et `full` de `e2e.config.ts`. Fixture `ARMY-L2-V3-FIXTURE-<run>` insérée en SQL
par `postgres` (`e2e/army/local/engine-v3-support.ts`, transport `E2E_ARMY_LOCAL_DB_URL` /
`E2E_ARMY_LOCAL_PSQL`) dans un projet du compte ARMY : une section, une ligne 2 × 15,00 € à
marge ×1,5, montants stockés nuls. Relue en v1, elle afficherait 45,00 € HT, 54,00 € TTC et un PU
de 22,50 €.

| Id | Défaillance | Parcours |
|---|---|---|
| E2E-01 | L'éditeur ou la fiche relit la v3 en v1 : totaux v1, pas de bandeau | V3FC01 : bandeau exact sur les deux pages, aucun des trois montants v1 |
| E2E-02 | Ouvrir la v3 la réécrit | V3FC01 : état SQL identique avant et après (révision, montants, lignes) |
| E2E-03 | Publier ou envoyer la v3 réussit, échoue sans message nommé ou laisse une trace | V3FC02 : `POST …/pdf` et `POST …/send` → 409 `ESTIMATE_ENGINE_UNAVAILABLE` avec le message du bandeau ; aucun document, aucun envoi, statut `draft`, état inchangé |

Le garde du navigateur critique interrompt tout `POST …/send`. La tentative d'envoi part donc du
processus de parcours vers l'application possédée, pour la seule fixture v3, avec les cookies de
la session (vérifiés par une lecture 200 de la v2 témoin), une clé de fournisseur vide (le
parcours la vérifie) et un destinataire en `.invalid`. La publication passe par le navigateur.

Les parcours v1/v2 de 2.0 (campagne `calc-v3`, valeurs de [tester-army-calc-v3.md](tester-army-calc-v3.md))
sont rejoués à la validation, sans modification.

## Écarts assumés par rapport au §14 de la conception

1. **Lignes d'une v3 envoyée (assertion 3).** Elles sont déjà immuables avant M1 : le déclencheur
   générique `bump_estimate_content_revision_from_item` refuse toute écriture de ligne d'une
   version non brouillon, quel que soit le moteur. Les trois assertions restent, vertes dès
   l'étape 2, comme régression. La conception annonçait un rouge.
2. **`commit_estimate_batch`.** Le lot attrape toute erreur de ses opérations et la rend en
   `committed: false` avec `ESTIMATE_BATCH_INVALID_INPUT` (« Le lot a été annulé. »). Le refus
   d'écrivain y est donc masqué : la suite exige le rejet sans écriture, pas le code. Pas de
   redéfinition (D2) ; le message nommé vient de la branche v3 de `batch-preparation.ts`.
3. **`list_approval_queue`.** La conception place la branche v3 en M4, mais exige une marge NULL
   en 2.1. M1 ajoute donc la branche « v3 → NULL ». Pour que l'assertion soit sensible, le
   contexte figé de la fixture porte un multiplicateur v2 (1,25), que la file exploite aujourd'hui.
4. **Ordre des refus à l'envoi.** Le refus du moteur précède la lecture de `RESEND_API_KEY` et
   d'`EMAIL_FROM`. Pour une v1/v2, seul change l'ordre des erreurs quand la configuration manque
   (aucun montant). Sans cela, la pile possédée, sans clé, ne peut pas montrer le refus nommé.
5. **Codes non fixés par la conception** : `ESTIMATE_V3_EMISSION_NOT_READY` en `0A000` ;
   `ESTIMATE_ENGINE_UNAVAILABLE` (HTTP 409) pour `EstimateEngineUnavailableError`.
6. **Immutabilité du moteur** : le premier refus d'un changement de moteur reste
   `ESTIMATE_CALC_ENGINE_VERSION_IMMUTABLE` ; les nouveaux déclencheurs ne doivent pas le précéder.
7. **Fixture SQL d'une v3 envoyée** : ses lignes sont insérées déclencheur de révision suspendu
   (historique synthétique, comme le test de montée de version) ; les gels synthétiques passent
   par le chemin de confiance (`service_role`, marqueur de gel, contrat d'écrivain).

## Rouges observés (17/10/2026)

Pile Supabase native possédée, WSL Ubuntu 24.04, Node 24.19.0, Supabase CLI 2.120.0, clone
`~/miaouffrage-lot2` à `3d8d2f8a` plus les fichiers rouges. Une exécution native à la fois.
Journaux complets (non versionnés) : `.e2e/lot2-2.1/red/` du clone.

**Étape 1, base sans M1** (`npm run db:ci:local`, sortie 1 ; sortie pgTAP complète par le même
harnais) : 14 fichiers, 1 266 assertions, `Result: FAIL`. Les 12 autres fichiers passent.
- `estimate-calc-engine-governance.test.sql` : 210 assertions, 3 échecs (16 à 18), tous
  `have: 23514 ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED` : la v3 du projet sonde ne peut pas être
  insérée. L'assertion réécrite « rejects calculation engine version 4 » et les contrôles
  structurels conservés passent.
- `estimate-calc-engine-v3-guards.test.sql` : 10 assertions avant l'arrêt, 7 échecs : garde
  `prosrc` (les six fonctions que M1 doit convertir sont hors liste blanche), CHECK `[1, 2]`,
  prédicat absent (`42883`), trois contrats d'insertion et la fixture `postgres` refusés en
  `ESTIMATE_CALC_ENGINE_VERSION_UNSUPPORTED` ; puis arrêt sur l'insertion de la fixture v3
  (ligne 350, même erreur). Le moteur 4, la RPC de création et l'insertion `authenticated` sont
  déjà refusés (verts).

**Étape 2, moteur 3 seulement admis** (CHECK et déclencheur d'insertion élargis par une migration
locale non conservée, retirée après l'exécution) : 1 316 assertions, `Result: FAIL`.
- gouvernance : mêmes 3 échecs, désormais `have: ok` (aucune garde ne voit la v3) ;
- garde v3 : 60 assertions, 39 échecs (1, 3, 7, 15-22, 25-30, 33-38, 43-44, 47-60). 32 sont
  `have: ok` (l'écriture, la revue, l'émission, la duplication réussissent) ; invalidation du gel
  `ok:false` (deux fois) ; appariement client `ok:true` ; neuf colonnes de version `ok` ; lot
  `ok:true - 5` (validé, une ligne de plus) ; file d'approbation `ok:2000` (formule v2 appliquée) ;
  ouvrages générés `P0002 GENERATED_OUVRAGE_NOT_FOUND`, levé après l'insertion de la section de
  repli ; passage direct à `sent` refusé par une garde de sceau postérieure, faute du refus nommé.
  Verts dès cette étape : contrats d'insertion, fixture, version envoyée immuable (écart 1), gels
  v2, contrôles positifs du contrat d'écrivain, colonnes neutres, témoin v2.

**Vitest** (Windows, `npx vitest run` sur les 9 fichiers) : 9 fichiers rouges, 13 tests en échec,
67 réussis (les tests existants de ces fichiers). Causes : modules `engine/capabilities` et
`engine/compute` absents ; le résolveur rend 1 pour 3 et 4 ; le sceau d'une v3 se calcule ;
l'approbation rend `false` sans gel ; l'envoi échoue sur `Configuration email manquante:
RESEND_API_KEY` au lieu du refus nommé ; la publication du PDF et les réglages réussissent ; la
règle ESLint ne signale aucune des six comparaisons. `npm run typecheck` : seules les deux
importations de modules absents échouent. ESLint des fichiers touchés : 0 erreur.
Rejoué le 17/10 après le rebasage sur `141218a9` (même commande, le filtre `engine` inclut aussi
le corpus figé de 2.0) : 10 fichiers, 9 rouges, 13 tests en échec (les mêmes), 69 réussis, corpus
figé vert. Le rebasage ne touchant ni SQL ni le verrou de dépendances, les rouges pgTAP et E2E
ci-dessus restent valables sans nouvelle exécution native.

**E2E** (`npm run e2e:army:local -- --grep "V3FC"`, un worker, sortie 1, archive
`.e2e/army/ci/2026-10-17T10-58-41-678Z-critical/`, pgTAP rouge du sous-lot écarté du clone pour
atteindre les parcours) : setup réussi, V3FC01 et V3FC02 en échec sur l'insertion de la fixture,
`SQLSTATE=23514`. Diagnostic complémentaire à l'étape 2 (même lanceur, archive
`2026-10-17T10-54-06-398Z-critical`) : la fixture s'insère ; l'éditeur et la fiche affichent la v3
en v1 (« Marge 50% », « HT 45,00 € », pas de bandeau) ; la publication répond 409 `LOCK_REQUIRED` ;
l'envoi, session vérifiée (200 sur la v2 témoin), répond 500 `Configuration email manquante:
RESEND_API_KEY` ; aucun document, aucun envoi, état inchangé. Les parcours détectent donc bien
la relecture v1 et l'absence de refus nommé.

## Implémentation (17/10/2026)

Commits `feat(lot2-2.1)` : la migration M1, puis le code TS. `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` : 0 ligne de diff.

**SQL** : `supabase/migrations/20261017113844_estimate_calc_engine_v3_fail_closed.sql` (manifeste
mis à jour). Chaque fonction redéfinie part de sa définition vivante (`20260812032857…sql`,
`20261013130248…sql`) ; le diff se limite aux lignes du moteur. M1 n'ajoute aucune colonne :
`upgrade_check.declared_new_columns()` ne change pas.

**TS** :
- `engine/capabilities.ts` : `EstimateEngineVersion`, `requireEstimateEngineVersion` (strict),
  `requireHistoricalEngine` (3 → `EstimateEngineUnavailableError`), `engineFreezesSnapshot`,
  `isLegacyEngine` / `isUnifiedEngine` (typés sur le seul moteur historique), `assertNever` ;
- `engine/compute.ts` : la façade `computeVersionBreakdown` ;
- `resolveCalcEngineVersion` refuse 3 par son nom et 4 et plus comme non pris en charge ;
- `errors.ts` : `EstimateEngineUnavailableError` devient une réponse 409 nommée ;
- les 46 comparaisons signalées par la règle ESLint passent par les prédicats ;
- publication du PDF, envoi, gel d'approbation, projection d'approbation, sceau, réglages et preuve
  de remise refusent une v3 avant tout verrou, gel, rendu, réservation, configuration d'envoi ou appel
  SQL ;
- la fiche, l'impression et l'éditeur affichent le bandeau (`EstimateEngineUnavailableNotice`).

### Écarts d'implémentation

8. **Prédicat en ligne dans les gardes `security invoker`.** `guard_estimate_v2_snapshot_columns`,
   `guard_estimate_project_v2_owner_change`, `guard_labor_role_v2_owner_change` et
   `open_estimate_review_cycle` s'exécutent sous `authenticated` ou `service_role`. Le schéma
   `private` leur est fermé depuis `20260719132414`. Un appel à `private.calc_engine_freezes_snapshot`
   y lèverait donc `42501` sur toute écriture v2. Ces gardes portent le même prédicat en ligne,
   `in (2, 3)`, que la garde `prosrc` ne voit pas ; les assertions de comportement F-SQL-04 à
   F-SQL-07 les couvrent. Seules les fonctions `security definer`
   (`capture_estimate_review_content_revision`, `invalidate_estimate_v2_snapshot_context`) appellent
   le prédicat. `require_fresh_v2_snapshot_for_publication` (liste blanche) refuse le moteur 3 par
   son nom avant sa branche v2, inchangée.
9. **Création d'une v3.** `enforce_estimate_calc_engine_on_insert` refuse le moteur 3 sous tout
   contrat autre que `canonical_v2` et `legacy_v1`, qui forcent 2 et 1. Il le refuse aussi hors du
   propriétaire natif (`current_user <> 'postgres'`) : `service_role` ne peut pas insérer une v3.
10. **Ordre des déclencheurs.**
    - Lignes : `aay_guard_estimate_item_engine_columns`, avant la garde v2 héritée. Toute colonne est
      « de calcul » sauf `title`, `position`, `aid`, `parent_id` et `updated_at` (comparaison
      `to_jsonb`, fermée par défaut pour toute colonne future).
    - Versions : `aac_guard_estimate_version_engine_v3_writer`, après le refus d'immutabilité
      (`aaa_…workflow_columns`) et avant `aad_require_fresh…`. Les colonnes de calcul forment une
      liste explicite : marges, remise, coefficient, TVA, arrondi, totaux, `contractor_role`,
      `currency` et gel non nul.
    - Documents : `aa_guard_estimate_document_engine_v3`, avant `aaa_guard_estimate_offer_document`.
11. **Surfaces agrégées.** La marge effective, la remise fixe et la Direction lisent le moteur par
    `resolveCalcEngineVersionForDisplay` : une v3 y est « indisponible », pas une erreur de page. Les
    chemins contractuels, eux, refusent par le nom.
12. **Éditeur.** Le composant serveur `edit/page.tsx` remplace l'éditeur par le bandeau avant tout
    chargement client : ni verrou, ni normalisation, ni sauvegarde. Si cette lecture échoue,
    l'éditeur signale sa propre erreur, et son chargement refuse lui aussi la v3 (résolveur).
13. **Projection d'approbation.** `syncEstimateApprovalSummary` refuse une v3 avant toute lecture ou
    écriture. La fiche l'appelle avant de lire la version : elle ne réécrit donc rien.
14. **`src/types/database.ts` inchangé.** M1 n'ajoute ni colonne ni fonction appelable ; les fonctions
    de déclencheur n'y figurent pas.
15. **Sites hors annexe A, laissés en l'état.** Ils supposent un moteur sans le comparer :
    - `src/lib/affaires/server.ts:2250-2269`, analyse de marge interne en v2 forcé (conception
      2.5) ;
    - `src/lib/takeoff/server.ts`, métré (2.8) ; le contrat d'écrivain le refuse déjà en SQL.

### Preuves vertes

Windows (worktree), Node 24 :
- `npm run typecheck` : 0 erreur ;
- `npx eslint . --max-warnings=0` : 0 message ; la règle est active, et 0 site reste hors de la
  liste blanche ;
- `npm run check:architecture` : budgets respectés, 0 cycle ;
- `npx vitest run` (suite complète) : 448 fichiers, 3 370 tests réussis, 2 ignorés (les mêmes que
  sur `main`). La commande du rouge (10 fichiers, ci-dessous) : 10 verts, 104 tests réussis.

WSL, clone `~/miaouffrage-lot2` au commit de la branche, pile native possédée, une ou deux exécutions
à la fois :
- `npm run db:ci:local` : 14 fichiers, 1 316 assertions, `Result: PASS`, matrice RLS passée ;
  `estimate-calc-engine-v3-guards.test.sql` (60) et la gouvernance réécrite passent. Le diagnostic
  de la liste blanche citait alors `private.calc_engine_freezes_snapshot` (corps `in (2, 3)`) ; le
  prédicat compare désormais 2 et 3 explicitement. Sur la migration finale, le pgTAP de la campagne
  `calc-v3` ci-dessous donne le même résultat (1 316, `PASS`) et un diagnostic « aucune » ;
- `npm run e2e:army:local -- --grep "V3FC"` : 3/3 (configuration, V3FC01, V3FC02), archive
  `.e2e/army/ci/2026-10-17T12-01-40-713Z-critical/`.
  - Éditeur et fiche : bandeau présent, aucun des montants v1, état SQL identique avant et après.
  - `POST …/pdf` et `POST …/send` : 409 `ESTIMATE_ENGINE_UNAVAILABLE` avec le message du bandeau.
    La session est vérifiée (200 sur la v2 témoin) ; aucun document, aucun envoi, statut `draft`.
- `npm run db:upgrade-check -- lot2-2-1` : 244 migrations de base, M1 appliquée, 0 différence.
  Le contrôle négatif intégré est détecté. Archive `.e2e/engine-v3/upgrade-check/2026-10-17T12-04-39-121Z-lot2-2-1/`.
- `npm run db:upgrade-check -- lot2-2-1-neg --negative-control` : 1 différence nommée
  (`estimate_items … pu_ht_cents: 1481 -> 1482`), verdict `detected`. La sortie 1 est attendue.
- `npm run engine:document-fingerprints -- check` : 14 familles identiques, agrégat
  `2b971551…78e4`, égal à la référence de 2.0 ;
- `npm run e2e:army:calc-v3` (non couverte par la CI) : 33/33 en 6 min 23 s, comme la référence
  de 2.0. Détail : journeys 11, components 5, numeric 4, resume 5, access 2, emission 6 ; pgTAP
  1 316 `PASS` et matrice RLS sur la migration finale ; validation de l'application passée. Archive
  `.e2e/army/ci/2026-10-17T12-06-11-633Z-calc-v3/`.

Archives non versionnées (`.e2e/` est ignoré), dans le clone WSL ; journaux de commande sous
`.e2e/lot2-2.1/green/`. Suites complètes : CI GitHub de la PR du sous-lot (voir ci-dessous).

## Vérification (17/10/2026)

Contre-épreuve sur `bd4e6ba7` (arbre propre), rejouée par une autre passe que l'implémentation.
Rien n'a échoué et aucun correctif n'a été nécessaire. Le prédicat `= 2 or = 3` y est désormais
couvert par tous les contrôles natifs, y compris `db:ci:local` et les parcours V3FC, qui avaient
tourné sur le corps précédent.

Windows (worktree), Node 24.19.0 :

| Commande | Résultat |
|---|---|
| `npx tsc -p tsconfig.json --noEmit --incremental false` | sortie 0, aucun diagnostic |
| `npx eslint . --max-warnings=0` | sortie 0, aucun message |
| `npm test` | 448 fichiers réussis, 1 ignoré ; 3 370 tests réussis, 2 ignorés, 0 échec (donc 0 nouvel échec par rapport à `main`) ; corpus figé compris |
| `npm run validate-openapi` | spécification valide et synchronisée ; 144 routes, 192 opérations |
| `npm run check:architecture` | budgets respectés, 1 100 modules, 0 cycle |
| `npm run supabase:validate` | 245 fichiers, 245 versions uniques |
| `npm run supabase:migrations:git-guard` | passé (2 changements dans le périmètre) |
| `git diff origin/main -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` | vide |
| `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` | propre |

WSL, clone `~/miaouffrage-lot2` à `bd4e6ba7`, Node 24.14.0, Supabase CLI 2.120.0, au plus deux
exécutions natives possédées à la fois :

| Commande | Résultat | Archive (`.e2e/` du clone) |
|---|---|---|
| `npm run db:ci:local` | 14 fichiers, 1 316 assertions, `Result: PASS` ; liste blanche sans entrée superflue (« aucune ») ; matrice RLS passée ; 28 s | journal `lot2-2.1/verify/db-ci-local.log` |
| `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep V3FC` | 3/3 (configuration, V3FC01, V3FC02), `workers: 2`, pgTAP 1 316 `PASS` et matrice RLS en amont ; 1 min 45 s | `army/ci/2026-10-17T12-17-19-520Z-critical/` |
| `npm run db:upgrade-check -- lot2-2-1-verify` | 244 migrations de base, M1 seule appliquée, 0 différence ; contrôle négatif intégré détecté | `engine-v3/upgrade-check/2026-10-17T12-18-04-790Z-lot2-2-1-verify/` |
| `npm run db:upgrade-check -- lot2-2-1-verify-neg --negative-control` | sortie 1 attendue : 1 différence, `estimate_items … pu_ht_cents: 1481 -> 1482`, exactement la migration synthétique | `engine-v3/upgrade-check/2026-10-17T12-18-27-089Z-lot2-2-1-verify-neg-negative-control/` |
| `npm run engine:document-fingerprints -- check` | 14 familles identiques, agrégat `2b9715519d99…391b78e4`, égal à la référence de 2.0 | `engine-v3/document-fingerprints/2026-10-17T12-22-21-140Z-check/` |
| `npm run e2e:army:calc-v3` | 33/33 : journeys 11, components 5, numeric 4, resume 5, access 2, emission 6 ; sources inchangées pendant la campagne ; 6 min 57 s | `army/ci/2026-10-17T12-19-15-539Z-calc-v3/` |

M1 n'ajoute aucune colonne : `upgrade_check.declared_new_columns()` n'a rien à déclarer. Le libellé
du contrôle de montée de version ne sert qu'à nommer l'archive. La campagne `e2e:army:local` complète
n'a pas été lancée en local (décision du propriétaire, 17/10) : elle passe par la CI de la PR.

## Commandes

```bash
# WSL, clone Linux (au plus deux exécutions natives possédées en parallèle)
npm run db:ci:local
npm run e2e:army:local -- --grep "V3FC"
# Windows ou WSL
npx vitest run src/lib/estimates/calc-engine-version.test.ts src/lib/estimates/engine \
  src/lib/estimates/estimate-seal.test.ts src/lib/estimates/approval-v2-snapshot.test.ts \
  src/lib/email/send-estimate.test.ts src/lib/estimates/pdf-generator.test.ts \
  src/lib/estimates/settings-atomic.test.ts src/test/engine-version-lint.test.ts
```

À la validation de 2.1 (§10.1 de la conception) : suite pgTAP complète, `npm run db:upgrade-check
-- lot2-2-1` (0 différence) et son contrôle négatif, corpus figé, empreintes documentaires,
`npm run e2e:army:calc-v3` (non couverte par la CI), en local sur la pile possédée. Les suites
complètes passent par la CI GitHub de la PR du sous-lot (décision du propriétaire, 17/10) :
Quality Gate (typecheck, lint, Vitest node et jsdom), RLS matrix (`db:ci:local`, pgTAP complet)
et Army critique sur pile locale du runner, qui inclut les parcours `engine-v3-*` ; la sélection
`full` (planifiée) se lance par `workflow_dispatch` sur la branche. Pas de campagne
`e2e:army:local` complète en local, seulement les parcours ciblés (`--grep`).

## Limites

- `commit_generated_ouvrages` n'est exercé que par sa section de repli « À classer », première
  écriture de la RPC ; `recalculate_takeoff_estimate_version` ne l'est qu'à travers
  `apply_takeoff_job_guarded_atomic`, seul point d'entrée autorisé.
- pgTAP ne charge pas `safeupdate`. Les nouveaux déclencheurs de M1 n'exécutent ni `UPDATE` ni
  `DELETE` ; les fonctions redéfinies gardent leurs clauses `WHERE` à l'identique. Les parcours E2E
  (session PostgREST) restent la seule preuve d'exécution sous `safeupdate`.
- La sonde d'envoi E2E ne passe pas par le navigateur (garde critique) ; elle ne prouve pas le
  comportement du bouton « Envoyer », dont la présence sur une v3 n'est pas fixée en 2.1.
- Les montants interdits du parcours (45,00, 54,00, 22,50) ne couvrent que la relecture v1 de la
  fixture, pas une relecture v2.
