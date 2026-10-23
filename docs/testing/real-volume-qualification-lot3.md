# Volumes réels — troisième lot de dette technique

Contrat écrit avant correction le 23 octobre 2026, base `af9cefa4`.
Le propriétaire demande aussi de simplifier `AGENTS.md` : le runtime natif
disponible remplace WSL obligatoire, les budgets et protections restent actifs.
Aucun déploiement ni migration distante n'est autorisé.

## Défaillances à prévenir

- La sonde se dit hydraulique mais ne crée que 1 021 éléments synthétiques :
  elle doit consommer le classeur public réellement utilisé par IO01,
  `e2e/fixtures/business/optima-hydraulique-fictif.xlsx`, avec ses 2 031 éléments,
  131 sections, 1 900 lignes et 785 lignes chiffrées, statuts et provenance.
- Une réévaluation de réglages à vide paraît rapide : vérifier les prix réellement
  modifiés, les écritures et les oracles financiers avant de retenir sa durée.
- Les copies de 100 et 1 000 opérations conservent une petite cible : mesurer
  la vraie cible hydraulique, sans réécriture de ses lignes, avec atomicité et
  refus à l'opération fautive conservés.
- Un budget en dépassement est seulement imprimé : vérifier les médianes de
  sept exécutions au volume réel, budgets locaux 1 000 / 875 / 400 ms, sans
  augmenter de timeout ou ajouter de retry. Distinguer SQL, route et navigateur.

Exception d'isolation : le navigateur ne mesure pas une instruction SQL ni ses
écritures internes. Les sondes pgTAP lisent le même classeur que l'application,
avec les parseurs d'import et le moteur SQL existants ; les parcours IO01 et
IO13 restent la preuve du véritable import, de la réévaluation, des lectures,
des fichiers téléchargés et de la copie persistée. Les oracles numériques
indépendants du corpus public restent inchangés. Les originaux privés ne sont
ni utilisés implicitement ni publiés.

## Qualification

Preuves canoniques sous `outputs/tech-debt-real-volumes-lot3-2026-10-23/`, hors Git.
Source de la qualification native et navigateur initiale :
`af9cefa4fd4427d22cee5f47d730bb26d8b3b880` et changements du lot,
conservés dans `qualified-source.patch` et `qualified-inputs.json` (incluant le
générateur encore non suivi au moment des tests). Le diff suivi exécuté a pour
SHA-256 `1fd6edc3d20674dd78178ca16b085aeea4e5534829ca3743e768d11f96c9b4dd`.
Avant le premier commit `94bffd10`, seuls ce rapport, les chiffres du guide et deux
commentaires historiques SQL sont complétés ; les entrées exécutables restent identiques
(`final-source-equivalence.json`, `post-qualification-sql-comments.json`). `build-source-before.json` et les
manifestes natifs identifient le build et ses 1 826 entrées.

### Corpus et corrections

Le classeur est vérifié contre le manifeste public : SHA-256
`cfedeb15a0d2c1bd9dc58d1174ed27d9a341bd048be168f56ae1d4d390f31acd`.
Il passe par le parseur OPTIMA et le normaliseur de l'application, puis alimente
uniquement un fichier SQL dans le répertoire temporaire possédé par le runner.
Le payload produit a pour SHA-256
`1491271adce2d0bc40c0e0a24580951c8cc1ed7be372d428ea37ecbc7deb39c5`.
Il conserve les 131 sections, 1 900 lignes, statuts, prix nuls et provenance.
Les 785 lignes à prix positif ne représentent pas tous les statuts `priced` :
1 821 lignes ont ce statut, dont 1 036 sans montant positif. Les autres sont
61 `out_of_scope`, 10 `included`, 7 `not_priced` et 1 `for_memory`.
À c_FO 1,30 / c_MO 1,20 et 40 €/h, l'oracle HT indépendant est **67 298,03 €**.

Le réglage c_FO 1,30 → 2 transmet toutes les projections et modifie réellement
785 lignes. Son budget est maintenant asserté. Le budget bulk passe du pro rata
de 500 ms sur 1 021 éléments synthétiques aux **1 000 ms déjà prévus pour
2 031 éléments** ; les budgets de copie et d'interaction restent 875 et 400 ms.
Aucun writer, calcul métier, timeout, dépendance ou migration n'est modifié.

Le premier contrôle qualité a détecté que l'import direct du parseur ajoutait
33 modules applicatifs au graphe du superviseur de développement. Un processus
Node/tsx enfant, sans shell et avec environnement local filtré, prépare maintenant
le classeur avant le démarrage de la stack. Le test existant du superviseur reste
inchangé. `AGENTS.md` privilégie les résultats et une vérification proportionnée,
en gardant les protections CI, les contrats métier et les limites d'autorisation.

### SQL, RLS et budgets

Commande :

```bash
PATH=/Users/timax/.local/share/mise/installs/node/26.12.1/bin:$PATH \
SUPABASE_TELEMETRY_DISABLED=1 DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local
```

Fenêtre de qualification finale le 23/10/2026, 15:31:16–15:32:41 UTC, Mac Apple M5 Pro
arm64, Darwin 27.0.0, 18 cœurs, Node 26.12.1, PostgreSQL 17.11, CLI Supabase
2.121.0 natif. Charges 1/5/15 minutes avant : 3,29 / 3,76 / 3,23 ; après :
3,80 / 3,71 / 3,25. Aucun build applicatif lancé en parallèle.

**PASS, sortie 0** : 29 fichiers pgTAP, **2 089 assertions** ; plafond de copie
**2/2** ; budgets **11/11** ; matrice comportementale RLS réussie. La génération
des types concorde toujours avec le schéma migré. Stack et utilisateurs éphémères
détruits par le runner.

| Instruction, cible hydraulique de 2 031 éléments | Médiane N = 7 | Budget | Échantillons SQL en ms |
| --- | ---: | ---: | --- |
| Création atomique | 584,3 ms | 1 000 ms | 588.4, 584.3, 582.0, 582.5, 587.8, 586.4, 580.2 |
| Réévaluation des réglages | 564,7 ms | 1 000 ms | 553.3, 548.9, 554.3, 565.1, 564.7, 577.0, 638.9 |
| Copie de 100 opérations | 153,2 ms | 400 ms | 153.2, 152.6, 153.2, 153.3, 152.0, 152.1, 156.7 |
| Copie de 1 000 opérations | 418,3 ms | 875 ms | 422.4, 411.4, 414.8, 418.3, 421.7, 417.2, 429.7 |

La copie de 1 000 opérations réussit aussi sur la petite cible témoin (médiane
302 ms). Dans les deux cibles : **0 ligne existante réécrite**, reçu de
2 042 395 octets, un seul INSERT d'items par copie. L'opération fautive 500 est
nommée et les 500 opérations précédentes sont annulées sans écriture persistée.
Le contrôle séparé du plafond 3 500 ms réussit à **459,3 ms** sur la grande cible.

Les mesures brutes sont dans `native-budget-final.log`, l'hôte dans
`benchmark-host-before.json` / `benchmark-host-after.json`. Les sondes existantes
v1/v2 ont aussi tourné ; le déplacement entre sections de 1 000/999 lignes reste
seulement diagnostique (613,3 ms). Le réordonnancement passe sa médiane à 381,3 ms
mais comporte deux échantillons à environ 2,4 s, visibles dans le journal.

### Parcours et qualité

```bash
npm run e2e:army:local -- --grep '^IO01 |^IO13 '
npm run verify:pr
```

IO01/IO13 exécutés dans un checkout QA temporaire détaché, sans `.env.local`, avec
les dépendances physiquement dans sa racine : **2 parcours + préparation auth,
3/3 passés, aucun échec, skip ou retry**. TesterArmy `e2e` 0.21.2,
`@e2e-dev/web` 0.15.2, build de production local inchangé pendant les tests.
La campagne filtrée prend 90,6 s, dont 30,25 s de runner navigateur.

- IO01 : import des 2 031 éléments, **785/785 prix exacts**, réglages 1,30/1,20
  puis au coût, CSV de **1 900 lignes**, PDF téléchargé. Six lectures consécutives
  retrouvent 2 031 éléments et **55 087,47 € HT au coût**, en 68–79 ms chacune.
- IO13 : copie atomique de **1 000 opérations**, 999 lignes avec prix et
  provenance exacts, 1 000 audits, montants HT/TVA/TTC conformes et persistés.
  La route répond 201 en **558 ms** (une observation, distincte de la médiane SQL).
  Les refus de taille et les autres limites gardent la cible inchangée.

Manifestes et preuves dans
`native/2026-10-23T15-32-43-535Z-critical/` : `manifest.json`,
`critical/report.json`, `critical/manifest.json`, téléchargements sous
`critical/results/` et oracles sous `critical/artifacts/business/`.
Fixtures : préfixes `ARMY-1792769624230-d2d9d340` (IO01) et
`ARMY-1792769645936-07841539` (IO13). Versions cibles :
`11e0b037-6eb3-4fe8-9ef0-6e80456348b5` et
`be6f760a-7d98-4739-a492-f09b4694a6ba`.
Les sources QA et canoniques étaient identiques avant et après la campagne.
Le dossier de preuves natif a été déplacé, sans copie de médias supplémentaire,
puis le checkout QA retiré après contrôle d'absence d'utilisation ; `qa-cleanup.json`
conserve la correspondance des anciens chemins absolus.

`verify:pr` après la correction du superviseur : **PASS, sortie 0**, 3 377 tests Node passés (3 skips existants,
un fichier hors exécution), 820 jsdom et 12 de couverture des frontières passés.
Audits, architecture, OpenAPI, types et lint réussis. Journal : `verify-pr-final.log`.
Revue indépendante : une lecture initiale et un suivi ciblé de la correction du
superviseur, aucun défaut actionnable restant (`review.json`).

### Échecs conservés et limites

Avant implémentation, le test de volume échoue sur **8 des 14 assertions** contre
l'ancienne sonde : `red-real-volume.log`. L'adoption initiale passe 14/14
(`real-volume-adoption.log`). Le premier `verify:pr` échoue sur la frontière du
superviseur (`verify-pr-failed-supervisor.log`) ; ce défaut est corrigé, son test
ciblé est passé (`supervisor-regression.log`) puis toute la chaîne est verte.
Le premier run natif complet avant cette correction est conservé séparément dans
`native-budget-before-supervisor-fix.log` ; ses chiffres ne remplacent pas ceux
du run final ci-dessus. Aucun rerun à l'identique pour masquer un échec.

Il s'agit du **corpus public fictif à la forme et au volume réels**, sans lecture
des originaux privés. Le payload de copie reste un cas synthétique chargé de
provenance ; sa cible est maintenant le véritable corpus public. Les nouvelles
mesures ne constituent pas un gain avant/après : la sonde et son volume ont changé.
Elles ne qualifient ni un hôte WSL absent, ni une latence terrain ou un maximum
de production. Le plafond SQL local et la route locale ne remplacent pas les
parcours CI et la cible de 3,5 s en production. Les autres parcours non sélectionnés
ne sont pas déclarés exécutés localement. Aucun déploiement ni migration distante.

## Suivi du premier push : environnement de préparation

Le [Quality Gate de `94bffd10`](https://github.com/maxlemeur/HEX_BC/actions/runs/39980272021)
a ensuite détecté un défaut propre à son environnement : le test réel de réservation
des ports fournit un environnement vide validé par le runner, mais le nouveau
processus enfant relisait `process.env`. Les deux réglages applicatifs factices
présents en CI déclenchaient alors le refus des variables Supabase préconfigurées.
Le build et les contrôles statiques CI avaient réussi ; le défaut concerne la
préparation isolée, sans appel à une base distante.

La correction transmet l'environnement déjà validé à `prepareProject`, puis au
filtrage du processus enfant. Le refus au préflight et la liste blanche restent
inchangés. Le test existant fixe désormais les deux variables ambiantes et les
restaure dans `finally` ; il exerce toujours la génération réelle du classeur,
la configuration et les huit ports, sans démarrer de service.

- Rouge avant correction : `red-preparation-environment.log`, même erreur que CI.
- Vert : `green-preparation-environment.log`, 1 test ciblé passé ; les 35 autres
  tests de ce fichier sont hors sélection. Une tentative bloquée par le sandbox
  sur l'ouverture d'un port est conservée dans `preparation-environment-sandbox-denied.log`.
- `verify:pr` final **avec les deux variables factices de CI** : sortie 0,
  3 377 Node passés / 3 skips existants, 820 jsdom et 12 frontières passés.
  Journal : `verify-pr-ci-environment.log`. Revue indépendante ciblée : aucun
  défaut restant sur la transmission d'environnement et la restauration du test.

Les preuves SQL chronométrées et IO01/IO13 ci-dessus sont **réutilisées** depuis
`94bffd10` : générateur, classeur, quatre fichiers SQL et parcours restent identiques
(`ci-correction-proof-reuse.json`). Seuls la transmission d'environnement avant
stack et son test changent ; les mesures ne sont pas présentées comme une nouvelle
exécution sur le commit correctif. La CI du nouveau push requalifie l'intégration
complète sur son propre commit.
