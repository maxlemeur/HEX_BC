# Assainissement du dépôt du 19 octobre 2026

Base : `44a969d3`, `main` propre. Périmètre autorisé : modifications locales,
préservation des données métier et des tests utiles, preuve avant retrait de
code. Aucun commit, push, changement distant ou réécriture de l'historique.

Le 20 octobre, le propriétaire autorise ensuite un commit local des seuls
changements d'assainissement, sans push. Les validations ci-dessous sont
réutilisées après vérification des empreintes des entrées. Ce complément
documentaire et un attribut Git limité au CSV préservent ses octets
Windows-1252/CRLF et son oracle ; aucune source exécutable ni fixture ne change.
Le contrôle d'espaces de l'index passe avec cet attribut, sans retirer les
contrôles habituels des espaces. Le document de performance sans rapport reste exclu.

## Défaillances à prévenir avant implémentation

1. Confidentialité : republier des originaux métier, une archive privée, un
   profil local ou un secret ; perdre les originaux en remplaçant les fixtures ;
   casser un clone neuf en lui faisant dépendre d'un corpus ignoré ; compiler ou
   linter les copies privées étrangères au checkout applicatif. Une régression
   de découverte précède leur exclusion ESLint ; TypeScript les ignore déjà.
2. Graphe : ignorer un import runtime à suffixe `.impl` ou `.logic`, manquer un
   cycle passant par ce module, ou compter CSS et imports de types comme code.
3. CI : ne pas exécuter les harnais spécialisés du tooling, ou accepter comme
   vert un job obligatoire sauté.
4. Documentation : présenter une preuve historique comme le contrat actuel,
   perdre des références utiles ou dupliquer les sources de vérité.
5. Découpage : changer l'identité de session d'un verrou, un en-tête, les
   autorisations, les transactions ou les montants lors d'une extraction.
6. Code dormant : supprimer un point d'entrée Next, un import dynamique ou un
   helper partagé à partir d'une simple absence de recherche textuelle.

Les régressions de processus et de graphe sont des exceptions d'isolation : un
navigateur ne peut observer le graphe interne du CLI, sa sélection de fichiers
ni le verdict du processus CI parent. Elles seront écrites et exécutées avant
leurs corrections. Les parcours métier affectés conservent leurs assertions
exactes ; aucune omission ou augmentation de budget ne vaut validation.

## Préservation et confidentialité

Les originaux sont conservés sous
`.private/repository-hygiene-20261019/originals/`, ignoré par Git, avec un
inventaire privé de chemins, tailles et SHA-256. Les octets sont revérifiés
avant tout remplacement ou retrait de l'arbre public. Les anciens résultats
sur ces données restent historiques ; les nouvelles fixtures fictives ne
prétendent pas être les originaux ni une nouvelle exécution de leurs preuves.

## Changements et preuves locales

Travail commencé le 19 octobre et poursuivi le 20 octobre, sur `44a969d3` avec
modifications locales. Les preuves techniques sont sous
`.e2e/repository-hygiene-20261019/` ; les inventaires de documents et le rapport
d'inspection historique sont privés sous `.private/repository-hygiene-20261019/`.

| Lot | Résultat et preuve |
| --- | --- |
| Préservation | 82 fichiers / 25 167 318 octets copiés, SHA-256 source/copie identiques ; 26 originaux retirés de l'arbre public courant, copies privées conservées |
| Confidentialité | Garde CLI hors réseau : chemins privés, secrets à signatures fortes et membres Office ; 6 tests rouges initiaux puis verts, régression de découverte ESLint rouge puis verte, 2 contournements trouvés en revue rouges puis corrigés ; final **8/8** (`privacy-*.log`, `private-discovery-*.log`) |
| Historique disponible localement | **12 892 blobs**, **15 archives** inspectés ; aucune signature forte détectée ; **9 limites** d'inspection consignées. Aucun fetch, aucune modification de l'historique. Ce contrôle ne certifie pas l'absence de données métier ou de mots de passe sans signature |
| Graphe | 2 régressions rouges avant correction, puis **7/7** ; **9 liens runtime rétablis**, aucun cycle et aucun budget relevé (`architecture-*.log`, `architecture-edges.json`) |
| CI | **11 rouges → 45 réussites**, 1 skip Bash préexistant sur ce Mac. Les jobs obligatoires sautés échouent ; seule l'omission du build sur PR est admise (`ci-*.log`) |
| Recettes du tooling | **63/63**, après correction du montage incomplet du harnais d'archive et sélection Python 3 POSIX. L'échec initial reste dans `ci-recipes.log` ; succès dans `ci-recipes-green.log` |
| Découpage | Cinq routes modèles importent leurs modules dédiés. Identité de page extraite, façades préservées et corps inchangé ; **89 Node + 15 jsdom** avant et après (`extraction-*.log`, `extraction-checks.json`) |
| Actions inutilisées | Trois Server Functions retirées après preuve ; cinq tests des seuls chemins morts retirés, cinq assertions utiles portées sur l'action active puis **5/5 avant et après** (`actions-*.log`) |
| Fichier accidentel | Fichier racine vide retiré : zéro octet et aucune référence dans les sources exécutables ; `empty-root-file.json` |
| Corpus public | Deux XLSX et un CSV entièrement fictifs ; vraie frontière export/parseurs verte, mêmes volumes/statuts/encodage et trois totaux littéraux indépendants (`corpus-final.log` et preuves `business-corpus-*`) |

Le rouge initial du corpus a été observé avant sa génération dans le transcript
du travail. Un replay distinct, sur les originaux préservés et le vérificateur
courant, conserve maintenant le refus attendu dans
`corpus-real-rejection-red.log` (code 1, sans cellules imprimées). Le replay
ne devient pas rétroactivement un artefact du premier run.

Les versions des outils du dépôt restent celles du lockfile. Les contrôles
utilisent Node 24.19.0 ; le runtime documentaire est distinct et ne sert qu'à
générer les XLSX. Aucun paquet applicatif n'est retiré faute de preuve de
non-utilisation.

## Revue indépendante

Les revues sont en lecture seule sur des périmètres stables, par un agent qui
n'a pas écrit le code concerné. La première revue confidentialité a reproduit
deux contournements avec données synthétiques : `.auth.json` déjà suivi, et
doublons de noms dans un ZIP. Les régressions rouges précèdent leurs corrections ;
le suivi ciblé confirme **8/8** et aucun constat restant. La revue CI a trouvé un
test dépendant du nom POSIX de Python ; il choisit désormais l'interpréteur par
plateforme, avec suivi ciblé. La branche Windows est relue, pas exécutée sur ce Mac.

Les revues du graphe, du découpage et des actions retirées ne trouvent pas
d'anomalie actionnable. Elles confirment notamment l'identité des huit fonctions
conservées d'initialisation, des contrôles de rôle et des transactions.

La revue du corpus a identifié une lacune de preuve : les nouvelles fixtures
non suivies n'entraient pas dans les empreintes avant/après du wrapper. Deux
contre-exemples réels modifient le TS puis le XLSX pendant le processus enfant :
**12 réussites / 2 échecs** avant correction, **14/14** après
(`corpus-input-{red,green}.log`). Le dossier public rejoint les entrées
fingerprintées ; aucun corpus privé ni secret n'est ajouté aux manifestes.

La chaîne globale a ensuite détecté une dépendance E2E interdite dans le
superviseur (`army-dev-loop.test.ts:825`) : **3 315 Node réussis, 1 échec,
3 skips**. Le test reste inchangé ; le sélecteur pur est déplacé sous
`scripts/tester-army/business-corpus-selection.ts`. Il ne lit aucun fichier,
ne dépend que de `node:path`, et conserve les mêmes choix et le même filtrage.
Ce nouveau module partagé rejoint lui aussi les empreintes : **14 réussites /
1 échec → 15/15** dans le spécialiste d'archives
(`corpus-selection-input-{red,green}.log`). La revue ciblée est close sans
constat restant. L'invocation ciblée dev-loop privée de sockets a été
interrompue et conservée ; la même commande reçoit l'accès local nécessaire,
sans modification de test ni de protection.

## Qualification finale

La qualification navigateur utilise une copie du candidat sans `.env`, sans
corpus privé et sans le document non lié apparu pendant le travail
`docs/testing/performance-production-2026-10-19.md`, préservé dans le checkout
principal. Les 2 626 entrées de la copie sont identiques au checkout par SHA-256
avant et après qualification (`qa-source-final.json`). Aucune branche n'est
créée et aucun secret partagé n'est utilisé.

Commandes retenues :

```sh
node --import tsx e2e/fixtures/business/verify.ts
npm run verify:pr
npm run e2e:army:local -- --grep 'IO01|IO03|V3E20|LEGCAT02|V3C01|V3C04|V3C05|LOCK02' --app-port 3129
git diff --check
```

Premières préparations conservées : l'audit npm a d'abord été arrêté par la
résolution réseau bloquée du registre (`verify-pr-final.log`), puis la chaîne
avec réseau autorisé a révélé quatre erreurs de typage d'environnements
partiels (`verify-pr-network.log`). Les types des environnements sont corrigés
sans hériter de secrets. La première préparation QA a été interrompue pendant
le build (code 130), sa pile nettoyée et son slot libéré ; ses contrôles SQL/RLS
étaient passés mais aucun parcours navigateur n'a été exécuté
(`qa-attempt-1/`). Le candidat corrigé reçoit une nouvelle copie figée.
La deuxième copie a construit le build et passé SQL/RLS, puis a été interrompue
pendant le lancement des parcours (130), afin de corriger la dépendance du
superviseur. Ses résultats ne qualifient pas les parcours
(`qa-attempt-2/`). La copie QA est resynchronisée sur le candidat final ; son
cache webpack du build antérieur est conservé, et le runner reconstruit et
identifie lui-même le build courant.

Résultats finaux sur ce candidat, Node **24.19.0**, macOS arm64 :

| Vérification | Résultat et preuve |
| --- | --- |
| `verify:pr` | **Code 0** ; audit et signatures, hygiène, architecture, OpenAPI, types et lint verts ; **66 cas** de recettes ; **3 316 Node + 820 jsdom + 12 couverture critique** réussis (`verify-pr-qualified.log`) |
| Omissions Node visibles | **3 skips préexistants** : garde Bash ≥ 4 indisponible sur ce Mac, deux cas RLS réservés au runner éphémère. La matrice RLS a été exécutée séparément dans la qualification ci-dessous ; le garde Bash n'est pas présenté comme exécuté |
| Corpus fictif | Vérification des vrais parseurs, volumes, statuts, CSV et totaux attendus : code 0 (`corpus-final.log`) |
| SQL et RLS | **28 fichiers SQL** pgTAP et matrice comportementale RLS réussis sur une base locale éphémère, reconstruite depuis les migrations ; aucune restauration de snapshot (`qa-final/database.log`) |
| Parcours affectés | **10/10 résultats** : authentification et neuf parcours métier, zéro échec, interruption, flaky ou skip sélectionné ; **72,60 s**, un worker et zéro jeton modèle (`qa-final/journeys-critical.log`, `qa-final/critical/report.json`) |
| Stabilité du candidat | Sources et build inchangés pendant les parcours : `changedDuringRun: false` pour les deux ; 2 626 entrées revérifiées dans les deux copies après exécution (`final-receipt.json`) |
| Préservation finale indépendante | **82/82 copies** et **26/26 retraits** revérifiés ; mêmes tailles et SHA-256, zéro fichier privé suivi, parents privés en 700 et fichiers sauvegardés en 600 |

La qualification locale dure **1 min 50 s**, du 19 octobre à 22:14:23 UTC au
19 octobre à 22:16:13 UTC (20 octobre en France). Elle sert le build de
production **`-Mqx5xuEDKN--LOLzn-tb`**, reconstruit sur le candidat local de
base `44a969d33ba1bed617f342850e93b956d85f400c`. Le manifeste conserve le diff
et ses entrées ; son SHA-256 est
`2b8d1b3a7a6de878e7aea7a1f094217a912575f727682fb70555dfedba1782f7`.
Les preuves sont copiées sous `.e2e/repository-hygiene-20261019/qa-final/` ;
le reçu de synthèse est `final-receipt.json`. Le présent rapport reçoit ensuite
uniquement ces résultats documentaires ; les entrées exécutables restent figées.

Les neuf parcours couvrent la création vide (`V3C01`), deux créations depuis
des modèles (`V3C04`, `V3C05`), la récupération après échec de réordonnancement,
les imports hydraulique et plomberie avec montants persistés (`IO01`, `IO03`),
les statuts importés dans le contrôle d'envoi, l'aperçu CSV (`LEGCAT02`) et la
concurrence acquisition/reprise de verrou (`LOCK02`). Le motif `V3E20` sélectionne
deux parcours distincts. Les **179 résultats hors sélection** ne sont pas qualifiés.

Cette preuve est locale et ciblée. Le benchmark de performance navigateur, les
plafonds SQL de performance, les anciens corpus privés et la branche Windows ne
sont pas présentés comme réexécutés. Les anciens déploiements et les données déjà
publiées restent inchangés : aucune publication ni purge d'historique n'est
autorisée dans ce lot. La conservation privée locale ne retire pas les originaux
des anciens commits ni des copies distantes.

## Preuve avant retrait des anciennes actions

Après correction du graphe, le service de langage TypeScript recherche les
références des symboles et résout les imports/réexports statiques et les imports
dynamiques littéraux de tous les fichiers JS/TS suivis. Le script et le résultat
sont conservés sous `.e2e/repository-hygiene-20261019/unused-actions-*`.
`quickCreateAffaire`, `startAffaireManualEstimate` et `startAffaireFromImport`
n'ont aucune référence de production externe ; leurs consommateurs sont leurs
propres tests et la chaîne interne de wrappers. Le module conserve en revanche
`initializeAffaireDraft`, appelé par `AffaireOnboardingClient`.

Le composant de création rapide a été déconnecté puis supprimé dans
`1d158d72` / PR 83. La documentation installée Next 16.4
`node_modules/next/dist/docs/01-app/02-guides/server-actions.md` décrit
l'élimination des Server Functions non utilisées. Aucune route ou export de
module d'API HTTP ne pointe vers ces trois symboles. Les moteurs, RPC et
helpers partagés d'import restent conservés.

Avant le retrait, les assertions de création vide, liaison d'import, conflit
d'import déjà lié et refus du rôle viewer sont portées sur l'action active
`initializeAffaireDraft`, puis exécutées sur l'ancien code. Seuls les cas
propres aux chemins démontrés inatteignables sont retirés. Les parcours
authentifiés de création/import restent dans la sélection finale.
