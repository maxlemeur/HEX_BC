# Socle fermé par défaut du moteur v3 (sous-lot 2.1)

Statut : **tests rouges écrits avant le code** (commits `test(lot2-2.1)` sur `lot2/2.1-socle-ferme`,
base `3d8d2f8a`). Aucun fichier applicatif, aucune migration : la migration M1 et le code TS
viennent ensuite et doivent faire passer ces tests sans en modifier les assertions. Source :
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

**E2E** (`npm run e2e:army:local -- --grep "V3FC"`, un worker, sortie 1, archive
`.e2e/army/ci/2026-10-17T10-58-41-678Z-critical/`, pgTAP rouge du sous-lot écarté du clone pour
atteindre les parcours) : setup réussi, V3FC01 et V3FC02 en échec sur l'insertion de la fixture,
`SQLSTATE=23514`. Diagnostic complémentaire à l'étape 2 (même lanceur, archive
`2026-10-17T10-54-06-398Z-critical`) : la fixture s'insère ; l'éditeur et la fiche affichent la v3
en v1 (« Marge 50% », « HT 45,00 € », pas de bandeau) ; la publication répond 409 `LOCK_REQUIRED` ;
l'envoi, session vérifiée (200 sur la v2 témoin), répond 500 `Configuration email manquante:
RESEND_API_KEY` ; aucun document, aucun envoi, état inchangé. Les parcours détectent donc bien
la relecture v1 et l'absence de refus nommé.

## Commandes

```bash
# WSL, clone Linux (une pile native à la fois)
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
`npm run e2e:army:calc-v3`, puis une campagne complète `E2E_ARMY_WORKERS=2 npm run e2e:army:local`.

## Limites

- `commit_generated_ouvrages` n'est exercé que par sa section de repli « À classer », première
  écriture de la RPC ; `recalculate_takeoff_estimate_version` ne l'est qu'à travers
  `apply_takeoff_job_guarded_atomic`, seul point d'entrée autorisé.
- pgTAP ne charge pas `safeupdate` ; les clauses `WHERE` des déclencheurs de M1 ne sont prouvées
  que par les parcours E2E.
- La sonde d'envoi E2E ne passe pas par le navigateur (garde critique) ; elle ne prouve pas le
  comportement du bouton « Envoyer », dont la présence sur une v3 n'est pas fixée en 2.1.
- Les montants interdits du parcours (45,00, 54,00, 22,50) ne couvrent que la relecture v1 de la
  fixture, pas une relecture v2.
