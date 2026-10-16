# Ligne de base et harnais de preuve du moteur v3 (sous-lot 2.0)

Statut : **terminé**, recalé le 16/10/2026 sur `main` (`45b4239c`, sous-lot 2.3 compris), sur
`lot2/2.0-ligne-de-base-v2` : `e3ef3622` (harnais et ligne de base) et `b37441d4` (parcours recalés
sur macOS et sur l'export du 2.3). L'ancienne branche `lot2/2.0-ligne-de-base` reste à `b26f5648`
(pas de force-push). Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md),
§2 (invariants I1 à I3), §10.2 à §10.4 et §14 « 2.0 ».

Le sous-lot ne modifie aucun fichier applicatif. Il ajoute des tests, des scripts, des fixtures, un
profil E2E et des documents. Il fige l'état actuel des moteurs 1 et 2 pour que chaque sous-lot suivant
prouve qu'il ne le déplace pas. `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts`
ont un diff nul ; il n'y a aucune migration.

## Défaillances observables et preuves

Chaque preuve est montrée sensible : contrôle négatif rouge ou comparaison à l'octet.

| Invariant | Défaillance à révéler | Preuve | Commande |
|---|---|---|---|
| I1 : aucun montant v1/v2 ne change | Arrondi, ordre des opérations, aiguillage de moteur, remise, autoliquidation, multi-taux, ventilation atelier/chantier, paliers, arrondi commercial, écrêtage int32, relecture figée, gel v2, arbre (M1 à M13 dans l'en-tête du test) | Corpus figé : 300 devis v1 et 300 devis v2 (graine `20261016`), sorties de `computeEstimateBreakdown`, `buildEstimateV2SnapshotProjection` et `computeReadOnlyTotals` comparées en JSON canonique | `npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts` et `npm run engine:frozen-corpus -- --check` |
| I1 : le harnais lui-même | Générateur non déterministe, fixture régénérée après un changement de moteur, fixture tronquée ou retouchée, comparaison trop lâche ou trop stricte (H1 à H5) | `--check` régénère et compare l'octet ; `--write` refuse d'écraser et refuse un moteur modifié ; comptes 300/300, SHA-256 et couverture minimale vérifiés | idem |
| I2 : les montants enregistrés ne bougent pas pendant une montée de version | Une migration du lot 2 réécrit une ligne existante ; la comparaison est aveugle | Base remise à la dernière migration publiée avant le lot 2, fixture peuplée, captures `to_jsonb` avant et après les migrations ultérieures, 0 différence exigée ; contrôle négatif : une valeur modifiée hors migration doit sortir comme différence nommée | `npm run db:upgrade-check -- <libellé>` et `-- <libellé> --negative-control` |
| I2 : découpage des migrations | Une migration de base modifiée ou supprimée, une migration antidatée absente de la base publiée, une coupure introuvable, un nom non canonique, ou une dépendance à l'ordre de listage rendent le test vide | Fonction pure `partitionUpgradeMigrations`, test isolé | `npx vitest run src/test/upgrade-check.test.ts` |
| I3 : les documents émis restent immuables | `prepareEstimateDocumentData`, l'export analysé ou les hash de sceau changent pour un devis existant | Empreintes SHA-256 de 14 familles v1/v2 (brouillons, envoyés, acceptés, historiques à sceau 1, 2 et 4, export), produites par les vraies fonctions serveur sur une pile possédée | `npm run engine:document-fingerprints -- check` |
| Parcours applicatifs de base | Mauvaise cible, preuve vide, fixture fausse, émission non prouvée, sources modifiées pendant la campagne, fuite dans les preuves, garde de route contourné | Campagne `calc-v3` en 6 phases sur la pile possédée ; contrat détaillé dans [tester-army-calc-v3.md](tester-army-calc-v3.md) | `npm run e2e:army:calc-v3` |
| Aucune régression ailleurs | Un fichier du 2.0 casse un test existant ou un parcours critique | Comparaison Vitest test par test avec `main` ; suite critique complète | `npm test`, `npm run e2e:army:local` |

Tests isolés retenus (AGENTS.md) : le corpus figé, car 600 devis comparés au centime sur toutes les
branches des moteurs ne se rejouent pas en E2E ; et le découpage des migrations, dont une erreur rendrait
le test de montée de version vide sans qu'aucun parcours ne le voie.

## Ce que la base du test de montée de version contient

Coupure : `20261015190000_scope_takeoff_recalculation_safeupdate.sql` (244 migrations). La fixture
`supabase/tests/upgrade/lot2-fixture.sql` charge 43 lignes dans 17 tables :
- une v1 envoyée et scellée, avec le marqueur de sceau absent et un document hérité ;
- une v1 brouillon à remise en cascade ;
- une v2 envoyée, avec contrat client 1, sceau 5, document, envoi et jeton de portail ;
- une v2 brouillon à remise fixe, dont une ligne issue de l'offre à 0 € ;
- une v2 brouillon à paliers de marge ;
- une offre fournisseur à 0 € en unité « ML » ;
- un modèle de devis.

Les montants sont saisis à la main, pas produits par le moteur. `session_replication_role = replica` ne
sert qu'à l'historique synthétique : passages à l'état envoyé, documents, envois et jetons. Tout le reste
passe par les vrais déclencheurs, puis la fixture vérifie références et historique avec les contrôles SQL
du dépôt. `lot2-compare.sql` capture aussi 12 contrôles SQL de validité
d'offre (`estimate_offer_client_valid`, `estimate_offer_document_proof`, `estimate_offer_identity_valid`,
`estimate_offer_client_items_match`, `estimate_offer_document_valid` en modes `legacy` et `strict`).

`supabase migration up` n'est pas dans la liste blanche de la CLI locale : les migrations ultérieures sont
appliquées par le `psql` natif, une transaction par fichier, avec inscription dans l'historique de la CLI
dans la même transaction.

## Commandes

Linux ou macOS sur puce Apple uniquement (runtime Supabase natif) ; sous Windows, dans WSL depuis un
clone Linux. Une pile native à la fois. Les lanceurs `e2e:army:*` refusent un `.env*` à la racine : les
lancer depuis une copie propre (clone ou worktree sans `.env.local`).

```bash
npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts src/test/upgrade-check.test.ts src/test/ci-guardrails.test.ts
npm run engine:frozen-corpus -- --check
npm run db:upgrade-check -- lot2-2-0
npm run db:upgrade-check -- lot2-2-0-neg --negative-control
npm run engine:document-fingerprints -- check
npm run e2e:army:calc-v3
npm run e2e:army:local
```

À rejouer à chaque sous-lot du lot 2 : corpus figé et empreintes sans régénération ; à partir de 2.1,
`db:upgrade-check` applique les vraies migrations du sous-lot au-dessus de la base.

Preuves (non versionnées, `.e2e/` est ignoré) : `.e2e/engine-v3/upgrade-check/<horodatage>-<libellé>/`
(`report.json`, `psql.log`), `.e2e/engine-v3/document-fingerprints/<horodatage>-check/`
(`comparison.json`, `after.json`, `manifest.json`), `.e2e/army/ci/<horodatage>-calc-v3/` et
`.e2e/army/ci/<horodatage>-critical/`.

## Valeurs de base

Première mesure : WSL Ubuntu 24.04, 16/10/2026, base `98408ef0` (voir [tester-army-calc-v3.md](tester-army-calc-v3.md)).
Régression finale : macOS 27.0.1 sur puce Apple, Node 24.19.0, ICU 78.3, Supabase CLI 2.120.0,
16/10/2026. Contrôles du harnais et Vitest au commit `e3ef3622` (2.0 recalé sur `main`) ; parcours
TesterArmy au commit `b37441d4`, qui ne touche que des fichiers de `e2e/army/local/`. Les manifestes
de preuve enregistrent `72c7ca9a` et `9963f404`, mesurés sur `18f4fa38` : hors de `docs/`, leur contenu
est identique à `e3ef3622` et `b37441d4` (`git diff --stat 9963f404 b37441d4 -- . ':(exclude)docs'`
est vide). Entre-temps, `main` n'a reçu que `45b4239c`, qui ne touche que la note de reprise.

| Preuve | WSL, 16/10 | macOS, régression finale |
|---|---|---|
| `db:ci:local` | 13 fichiers pgTAP, 1 253 assertions PASS, matrice RLS passée | identique, 44 s |
| Corpus figé | 600 cas, généré à `10da1caf` | identique à l'octet : `sha256:d593056c…811f`, 2 756 052 octets |
| Montée de version | 0 différence ; contrôle négatif détecté, deux fois | 0 différence (13 s) ; contrôle négatif : `estimate_items …0112 pu_ht_cents: 1481 -> 1482`, seule différence, exit 1 attendu |
| Empreintes documentaires | `before.json` enregistré, reproduit sur une seconde pile | 14 familles identiques, agrégat `2b971551…78e4`, aucun avertissement d'exécution |
| Vitest | — | 3 331 tests : 3 328 réussis, 3 ignorés, 0 échec ; contre `main` (3 322) : les 9 tests du 2.0 en plus, aucun test retiré, aucun statut changé |
| `e2e:army:calc-v3` | 33/33 en 6 min 02 s ; valeurs par phase dans [tester-army-calc-v3.md](tester-army-calc-v3.md) | 33/33 en 5 min 04 s au commit `b37441d4`, copie propre (diff local vide), sources inchangées, confidentialité passée ; quatre PDF de 2 pages, en-tête et pied 20,00 € / 4,00 € / 24,00 € identiques. Avant le recalage des parcours : 26/33 (voir plus bas) |
| `e2e:army:local` | — | 68/68 (19 fichiers) en 9 min 54 s au commit `b37441d4`, copie propre, un worker, confidentialité passée ; archive `.e2e/army/ci/2026-10-16T18-48-16-830Z-critical/` |

## Recalage sur 2.3 et passage sur macOS

Première campagne `calc-v3` après le rebase sur `main` (macOS, `e3ef3622`, archive
`.e2e/army/ci/2026-10-16T18-32-43-850Z-calc-v3/`) : `resume`, `access` et `emission` vertes ;
`journeys` 9/11, `components` 3/5 et `numeric` 1/4 rouges. Deux causes, toutes deux hors du code
applicatif :

1. **Clavier macOS.** `typeNumeric` (`e2e/army/local/numeric-entry-support.ts`) vidait le champ par
   `Control+A`, qui sous macOS ramène seulement le curseur en début de ligne : la saisie était
   ajoutée devant l'ancienne valeur (« 12, » devant « 40,00 » donne « 12,40,00 »). NI01 à NI03
   échouaient. Remplacé par `ControlOrMeta+A`, sans changement sous Linux ni Windows.
2. **Export DPGF du 2.3.** `f699dc9d` (P-11, revue R5 du 2.3) écrit « Majoration MO (%) » en
   pourcentage, 100 = neutre. Les parcours de `e2e/army/local/` hors de la suite critique attendaient
   encore le coefficient 1 : WFC01, CA01, GC01, GC02 et les aides `numeric-entry-support.ts` et
   `source-coverage-support.ts`. CA01 comparait en plus K MO à la majoration et inversement ; les deux
   valant 1, l'inversion ne se voyait pas. L'attendu est désormais le coefficient stocké converti
   exactement (`majorationPercent`, oracle propre au harnais) dans l'ordre des colonnes de l'export.
   Aucune valeur métier n'est assouplie.

`source-coverage-support.ts` appartient au profil `coverage`, qui ne tourne que sur la pile d'audit
(`127.0.0.1:59827`) : sa correction n'a pas été exécutée.

Le sous-lot 2.3, fusionné entre la mesure WSL et le recalage, a modifié `src/lib/money.ts` et
`src/lib/numeric-input/parsers.ts`, deux sources enregistrées dans la provenance du corpus. Le corpus
reste identique à l'octet : 2.3 n'a déplacé aucun montant v1/v2. La provenance garde les empreintes de
la génération, ce qui est voulu ; on ne régénère jamais le corpus pour absorber un changement.

## Limites

- Le 2.0 n'a aucune migration : en mode normal, `db:upgrade-check` applique 0 migration ultérieure. Le
  chemin d'application n'est exercé que par la migration synthétique du contrôle négatif. La première
  vraie montée de version arrive avec 2.1 ou 2.2.
- La fixture de montée de version est petite (43 lignes). Elle couvre une ligne par état contractuel, pas
  la diversité du corpus figé.
- Les 3 tests Vitest ignorés le sont aussi sur `main`. Sur macOS, `bash` 3.2 ne permet pas d'exécuter
  le garde-fou des cibles Supabase de `src/test/ci-guardrails.test.ts` : il est ignoré localement et
  exigé en CI (Linux). Les deux tests de `src/lib/estimates/rls.e2e.test.ts` ne tournent que par
  `db:ci:local` (matrice RLS passée).
- Les parcours rouges à la base (OF03, GR01, GR03, GR05, GR07, GR09) restent hors de la sélection par
  défaut de `calc-v3` ; leurs causes sont consignées dans [tester-army-calc-v3.md](tester-army-calc-v3.md).
  Tant qu'ils ne sont pas corrigés, la campagne ne prouve ni la confidentialité du portail (OF03) ni
  ces cas de reprise.
- L'émission tourne en `next dev` ; l'extension au build de production relève du sous-lot 2.7.
- Les preuves restent sur la machine qui les a produites ; le dépôt garde les commandes et les valeurs.
