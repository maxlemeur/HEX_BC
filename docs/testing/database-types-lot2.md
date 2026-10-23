# Types Supabase — lot 2 de dette technique

Contrat de correction écrit avant l'implémentation, le 23 octobre 2026.
Source initiale : `d4d467e8a0976797ae6a9f7717c4ea13efa47ee2`.
Le lot porte sur la génération locale des types et leur adoption dans les
règles de devis et les brouillons d'ouvrages. La qualification des volumes
réels reste le lot suivant. Aucun déploiement ou migration distante.

## Défaillances et qualification prévue

| Frontière | Défaillance observable | Vérification |
| --- | --- | --- |
| Contrat TypeScript/SQL | Les tables `estimate_rules` et `estimate_generated_ouvrage_drafts` ne sont pas reconnues ; les casts neutralisent la vérification des colonnes et écritures. | Régression de compilation avant correction : vrais noms de tables/colonnes, écritures typées, contre-exemples de colonne et de valeur invalides. |
| Génération | Une migration change le schéma mais les types suivis restent anciens, ou la génération dépend du projet distant. | CLI épinglée sur une pile locale migrée possédée par le runner ; deux générations identiques ; contrôle qui échoue sur une dérive. Aucun identifiant distant ou secret dans la commande et la preuve. |
| Échec et isolation | Une génération partielle écrase le fichier valide ; une erreur conserve une pile ou des secrets. | Publication du résultat seulement après réussite ; refus des cibles non possédées et nettoyage du runner existant sur succès/échec. |
| Compatibilité métier | La remise en place des types modifie une requête, un montant, les droits ou la persistance. | Garder les requêtes et validations métier ; parcours TesterArmy existants d'approbation et de lecture/revue/reprise/application des ouvrages, avec leurs assertions exactes ; `verify:pr` sur les sources finales. |
| Surcharges et JSON | Une surcharge RPC perd ses arguments nuls ou ses champs propres ; un retour composite masque la valeur JSON `null`. | Avant correction de revue, contre-exemples de compilation sur l'application takeoff à la racine, sa surcharge avec jeton, le bon de commande sans remplacement de lignes et `approval_summary` retourné par RPC. Les contraintes d'écriture du générateur restent vérifiées. |

La compilation est une exception d'isolation nécessaire : un navigateur ne
peut pas prouver qu'une colonne inconnue ou une écriture invalide sera refusée
par TypeScript. La génération se vérifie par sa vraie interface CLI et le
PostgreSQL natif local, et les parcours métier gardent leur qualification
TesterArmy. Les raffinements métier qui dépassent l'introspection SQL doivent
rester explicites, sans réintroduire une copie manuelle du schéma.

## Correction livrée

`npm run supabase:types` produit le contrat de `public` depuis les migrations
rejouées sur la pile native possédée : 110 tables, 191 fonctions et 23 enums,
contre 73, 132 et 16 dans l'ancienne copie manuelle. Deux générations doivent
être identiques. L'écriture atomique intervient après SQL/RLS et nettoyage.
`check:database-types` vérifie les empreintes de CLI, configuration, migrations
et sortie dans `verify:pr` ; le runner natif compare en plus une vraie
régénération au fichier suivi, avant pgTAP et les parcours.

L'adaptateur `database.ts` conserve les unions de contraintes CHECK, les
arguments RPC explicitement nullables, les surcharges et la valeur JSON
`null` en lecture de tables comme de retours RPC. Il garde les contraintes
Insert/Update de la CLI. Les noms de ses raffinements sont contrôlés par les
types générés. Il ne recopie plus les définitions de tables et de fonctions.
L'exception d'architecture existante suit uniquement le fichier généré ;
l'adaptateur reste soumis aux budgets ordinaires, sans hausse de plafond.

Les 74 `as never` de `rules-engine.ts` et les 35 de `generated-ouvrages.ts`
sont supprimés, ainsi que le client à schéma virtuel des règles. Les requêtes,
filtres et validations métier restent identiques. Les objets temporaires et
fixtures décrivent désormais les colonnes SQL manquantes, avec leurs valeurs
nullables ou leur défaut `pricing_status = 'priced'` ; aucune assertion
métier existante n'a été retirée.

## Exécutions du 23 octobre 2026

macOS arm64, Node `26.12.1`, Supabase CLI `2.121.0`, e2e `0.21.2`,
`@e2e-dev/web` `0.15.2`. Les preuves locales sont conservées sous
`outputs/tech-debt-types-lot2-2026-10-23/`, hors Git.

Les campagnes qualifient la révision initiale ci-dessus avec les modifications
du lot : `diffSha256 = 1b091c30fb5619b63f8473561794ff8c20594d55694777495ccd4d602d6b56d4`.
Les 1 825 entrées applicatives portent l'empreinte
`2b7debb8feb130e337441ac2886997e2327b6081cbfadcead7fd7c50b3e8d6dd`.
Le compte rendu est finalisé ensuite ; ces entrées applicatives restent
identiques. Empreinte du fichier généré :
`82377da326a42ff036e082dd5e3bf7febd52d5aefd0076002296e4f63ff88b4e`.

| Commande ou contrôle | Résultat observé | Preuve dans ce répertoire |
| --- | --- | --- |
| Compilation et gardes avant correction | Colonnes/tables absentes refusées ; 2 gardes de génération rouges avant implémentation. Après revue, 5 TS2322 reproduisent les écarts de nullabilité avant leur correction. | `red-types.log`, `red-generation-guards.log`, `red-review-contracts.log` |
| `npm run supabase:types` | Deux générations identiques ; pgTAP 29 fichiers / 2 084 assertions, 2 assertions de plafond CI et matrice RLS verts ; publication et nettoyage réussis. | `generate-native-final.log` |
| Vraie interface CLI, contrôles négatifs | 5/5 : fichier valide, dérive du corps refusée, dérive de provenance refusée, cible distante refusée avant démarrage, fichier restauré et toujours valide. | `negative-controls.json`, `negative-controls.mjs` |
| `npm run verify:pr` | Vert : audits, contrats, architecture, OpenAPI, compilation, lint, recettes, Node 3 377 réussis / 3 ignorés, jsdom 820 réussis, couverture critique 12 réussis. | `verify-pr-reviewed.log` |
| `npm run e2e:army:local -- --grep '^V3P01 '` | 2/2 sélectionnés exécutés : connexion et V3P01 ; montants/oracle, réglages, gel, marge d'approbation et duplication. Environ 60 s pile/build/parcours compris. | `native/2026-10-23T14-28-52-037Z-critical/` |
| `npm run e2e:army:calc-v3 -- --phase resume` | 5/5 sélectionnés exécutés : connexion et GR02/04/06/08 ; pagination des 21 brouillons, reprise partielle sans double insertion, fermeture/changement de version, unité/provenance dans API, UI et vrai classeur DPGF. Environ 67 s pile/build/parcours compris. | `native/2026-10-23T14-30-19-062Z-calc-v3/` |

Les deux campagnes passent chacune la comparaison native des types, pgTAP et
la matrice RLS ; les sources et builds restent inchangés pendant les parcours.
Elles n'ont aucun échec, interruption, reprise automatique ou test sélectionné
ignoré. Les rapports SDK, identités de fixtures, journaux, manifestes et
empreintes sont conservés dans leurs répertoires natifs. Builds :
`eaBZ515ohl1jDCa0I_PFt` (V3P01) et `VO5lLXeYP5VpTEc0l5Xjp` (resume).

Revue indépendante en lecture seule : une revue initiale et un suivi ciblé.
Les deux P2 (surcharge takeoff et JSON null dans les retours RPC) sont clos,
avec compilation rouge puis verte et contrôle indépendant des contre-exemples.
Aucun constat restant. Les trois alias rendus inutiles par la suppression du
schéma virtuel sont retirés après le diagnostic lint.

## Préparation, nettoyage et limites

Le premier essai canonique est arrêté avant parcours par la présence de
fichiers `.env` partagés. Une copie détachée de vérification est alors créée
sous `~/Projects/.workspaces/mergeone`, sans branche ni configuration partagée,
et comparée aux sources canoniques. Son premier build est arrêté par le
contrôle PDF : le lien vers `node_modules` place des dépendances hors de la
trace. Une copie APFS locale des mêmes dépendances corrige cet environnement,
sans changer les sources. Ces deux essais restent **échoués, sans parcours
exécuté**, sous `native/2026-10-23T14-25-03-156Z-critical/` et
`native/2026-10-23T14-26-39-006Z-critical/`.

Les piles sont arrêtées et détruites par le runner ; la copie de vérification
et ses dépendances sont retirées après contrôle d'absence d'usage et
conservation des preuves. `qa-workspace.json` et `qa-cleanup.json` tracent
l'identité, le déplacement des preuves et ce nettoyage. Pour reproduire les
campagnes, utiliser un checkout propre sans `.env`, Node épinglé et des
dépendances locales à sa racine.

Les trois skips de `verify:pr` sont existants : deux tests RLS réservés au
runner natif (exécutés avec succès par les campagnes) et un garde CI exigeant
Bash >= 4 (réservé ici à la CI Linux). Ils ne sont pas comptés comme réussis.
Les parcours GR01/03/05/07/09 restent hors de la sélection `resume` existante,
avec leurs raisons historiques dans `phase.json` ; ce lot ne les qualifie pas.
Aucune génération IA par fournisseur réel n'est exécutée. Les assertions de
plafond CI ne constituent pas la qualification des volumes réels en médiane
de sept mesures WSL, qui reste le lot suivant. La suite critical complète reste
le contrôle CI de `main`, sans la dupliquer en local ; les autres phases full
et calc-v3 conservent leurs déclenchements existants.

Aucune migration, aucun manifeste de migration, aucune dépendance ni
configuration de déploiement n'est modifié. Aucun déploiement ni migration
distante n'est effectué.
