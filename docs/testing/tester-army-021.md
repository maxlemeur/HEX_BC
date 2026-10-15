# TesterArmy 0.21 et remise en état des tests

Travail local du 15 octobre 2026, sans commit ni push. Les modifications déjà
présentes sont inventoriées dans `.codex-tmp/army021-20261015/baseline.json`.

## Défaillances et preuves prévues avant adaptation

| Risque observable | Vérification prévue |
| --- | --- |
| Une campagne trop longue est présentée comme réussie ou perd ses scénarios non exécutés | Exécution réelle avec `--max-duration`, sortie non nulle, `RUN_TIMEOUT`, états interrompus et raisons d'omission conservés dans le manifeste ; rejeu complet ensuite. |
| Une recette critique en production perd l'identité du build | Inclure `productionBuild` dans son manifeste, comme les campagnes de performance, et vérifier ses empreintes à la fin. |
| Le serveur reçoit un mauvais backend après la migration de sa configuration | `app.command.inheritEnv` limité aux noms nécessaires ; connexion ordinaire et parcours ARMY sur Supabase local, garde réseau conservée. |
| Le lecteur XLSX utilise un téléchargement d'une autre tentative | Utiliser `waitForDownload().absolutePath`, vérifier son appartenance au répertoire de résultats courant, puis cellules métier et empreinte du fichier réel. |
| Une saisie dépend des animations | Exécuter la saisie, la sauvegarde et le rechargement sous `browser.emulateMedia({ reducedMotion: "reduce" })`, vérifier la préférence réellement observée et les valeurs exactes. |
| Une attente historique exige encore qu'un dépassement monétaire soit silencieux | Le cas limite existant doit exiger `isCapped: true` et conserver les valeurs plafonnées exactes. Le moteur ne doit pas être modifié pour satisfaire l'ancienne anomalie. |

Le cas monétaire reste isolé : il couvre la propagation du dépassement lors du
calcul intermédiaire à la limite entière de stockage, difficile à créer par
l'interface sans franchir ses validations de montants. Il existe avant ce lot ;
son ancien oracle figeait explicitement un défaut désormais corrigé. Aucun
nouveau test unitaire après implémentation.

Les 83 échecs préexistants sont traités par cause, sans suppression de scénarios
ni modification générale des seuils. Les doublures devenues incompatibles avec
les contrats actuels sont corrigées en conservant leurs assertions métier.

## Sources de la montée de version

- [e2e 0.21.0](https://github.com/tester-army/e2e/releases/tag/e2e@0.21.0)
- [Moteur web 0.15.0](https://github.com/tester-army/e2e/releases/tag/@e2e-dev%2Fweb@0.15.0)
- Guides et types installés sous `node_modules/e2e/` et `node_modules/@e2e-dev/web/`.

Versions épinglées : `e2e` 0.21.0 et `@e2e-dev/web` 0.15.0, qui utilise
`playwright-core` 1.64.0. Les lectures de propriétés attendent désormais un
élément unique ; cela ne remplace pas une assertion qui attend sa valeur.

## Résultats navigateur

Build production local `U-3qi7TnTK6H-X9GzH1HF`, Node 24.19.0, Supabase natif
local WSL. Aucun appel modèle, e-mail, migration partagée ou déploiement.

| Exécution | Résultat et archive |
| --- | --- |
| Limite volontaire de 1 ms | Sortie 1, `RUN_TIMEOUT`, deux cas sélectionnés omis avec `time-limit`, zéro cas exécuté ; `.e2e/army/runs/2026-10-15T07-27-52-629Z`. Cette preuve porte sur l'arrêt avant exécution, pas sur l'interruption d'une action déjà commencée. |
| Campagne `army-021` | **16 sélectionnés, exécutés et réussis**, zéro échec, omission ou retry ; 539,06 s. `.e2e/army/critical/runs/2026-10-15T07-36-10-503Z`. |
| Smoke desktop et viewport mobile | **2/2**, avec deux pages de trace conservées ; `.e2e/army/runs/2026-10-15T07-45-30-217Z`. |

Les campagnes réussies déclarent `source.changedDuringRun=false`. Le manifeste
critique contient désormais le build exact et les empreintes de ses fichiers.
Les rapports, JSON métier et XLSX téléchargés restent dans les archives, hachés.

La campagne couvre connexion, refus anonymes, arrondis, imports CSV DPGF,
sauvegarde/rechargement, duplication indépendante, exports XLSX/DPGF et impression,
association d'article, saisies invalides, remise, collage, formulaire avant
hydratation, concurrence et les huit refus/quatre succès des verrous secondaires.
Le scénario numérique vérifie effectivement `prefers-reduced-motion: reduce`.
Les téléchargements sont lus via `absolutePath` après validation du chemin réel ;
leurs cellules et montants restent contrôlés exactement.

Rejeu avec le profil local privé existant, après build :

```powershell
$env:E2E_ARMY_SERVER_MODE = 'production'
$env:E2E_ARMY_CRITICAL_SELECTION = 'army-021'
node --env-file=.e2e/tech-debt-lot1/local.env scripts/run-tester-army.mjs critical
```

Les scénarios interrompus, filtrés ou ignorés ne constituent jamais une preuve
de réussite. Le viewport mobile du smoke ne qualifie pas un appareil natif.
La campagne métier reste Chromium desktop et locale ; elle ne qualifie pas le
cron GitHub déployé, les fournisseurs externes ni les envois réels.

## Remise en état de la suite globale

Les corrections des 83 échecs portent sur des contrats de tests devenus obsolètes,
sans modification produit dans cette continuation :
[documents et commandes](tech-debt-document-tests.md),
[serveur et file d'édition](tech-debt-server-test-contracts.md),
[portail et approbation](tech-debt-portal-approval-tests.md), plus le cas de plafond
monétaire ci-dessus. L'export XLSX couvre explicitement brouillon et devis émis.
Les revues croisées n'ont trouvé aucune assertion métier affaiblie.

Le premier passage global à deux processus a terminé avec zéro assertion échouée
mais un arrêt inattendu du processus exécutant les quatre tests de rendu PDF.
Son code de sortie 1 l'invalide, malgré `success: true` dans le JSON Vitest ; les
quatre assertions `pending` ne sont pas des réussites. Les fichiers
`initial-tests-all.log/json` préservent ce résultat. Ces quatre tests ont ensuite
réussi seuls, sans modification. Aucun événement Windows ni message ne permet
d'attribuer l'arrêt initial à un manque de mémoire ou à un défaut précis.
Le rejeu global à un processus sort **0** : **3 093 réussites, zéro échec,
3 ignorés**, 443 fichiers réussis et un fichier ignoré, en 351,36 s. Les quatre
assertions PDF interrompues au premier passage sont cette fois exécutées et
réussies. La cause du premier arrêt reste indéterminée ; le succès du rejeu ne
prouve pas une cause mémoire. Aucune assertion en attente n'est comptée réussie.

Les trois ignorés sont les deux scénarios RLS réservés au runner local dédié et
le contrôle de shell CI qui exige Bash >= 4. Ils n'ont pas été activés par cette
commande et ne constituent pas une qualification supplémentaire de la base/CI.

Commande globale :

```text
npm test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=.codex-tmp/army021-20261015/tests-all.json
```

Lint global, typage, OpenAPI, build production et les quatre budgets de taille
passent. Le premier build a détecté une annotation de type manquante dans la
fixture serveur en cours d'édition ; le build final inclut sa correction.
Le diff ciblé est contrôlé en reconnaissant les fins de ligne CRLF déjà utilisées
dans le test PDF. Les changements initiaux hors périmètre gardent leurs SHA-256.

Inventaire des 27 fichiers de cette continuation, copies des sources, empreintes,
rapports et contrôles : `.codex-tmp/army021-20261015/final-manifest.json`.
Le commit de départ reste `28ccc857287b3493927cfc5c634a53464025d838` sur `main`.
