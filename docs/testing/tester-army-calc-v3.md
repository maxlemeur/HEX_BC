# Campagne de calcul et d'émission

`npm run e2e:army:calc-v3` crée sa propre pile native, applique les migrations,
exécute les contrôles SQL/RLS et construit l'application en production. Elle
provisionne les propriétaires, rôles et états de départ nécessaires, puis
exécute chaque phase dans une invocation TesterArmy distincte et détruit la
pile. Aucun backend partagé n'est nécessaire.

Les contrats métier sont dans [les règles de calcul](../metier/regles-de-calcul.md)
et [le cycle de vie](../metier/cycle-de-vie.md). La source exacte des parcours,
filtres et nombres attendus est
[`calc-v3-phases.ts`](../../scripts/tester-army/calc-v3-phases.ts) ; les fixtures
sont dans [`calc-v3-fixtures.ts`](../../scripts/tester-army/calc-v3-fixtures.ts).

## Exécuter

Depuis un checkout préparé selon le [guide local](tester-army-local-development.md) :

```sh
npm run e2e:army:calc-v3
npm run e2e:army:calc-v3 -- --phase journeys --app-port 3118
npm run e2e:army:calc-v3 -- --phase resume --grep '^GR06\s' --app-port 3118
```

`--grep` exige une phase explicite. Les ports 45585 et 33485 de l'ancienne pile
de recette sont refusés. Les sources et le build restent fixes pendant une
campagne. Un run filtré conserve sa portée et ne vaut pas campagne complète.

| Phase | Parcours et frontière principale |
| --- | --- |
| `journeys` | Arrondi commercial, imports DPGF, ordre des totaux, création et batch atomiques |
| `components` | Décisions et composants des ouvrages générés |
| `numeric` | Saisie numérique des composants |
| `resume` | Reprise, pagination, absence d'insertion indue, unité et exports : GR02, GR04, GR06, GR08 |
| `access` | Refus de reprise après archivage/rétrogradation du propriétaire dédié |
| `offers-zero-price`, `offers-purchase-unit` | Prix fournisseur nul et unité d'achat, une phase chacun avec ses fixtures catalogue dédiées |
| `emission` | Émission historique, fichiers réellement reçus par le collecteur local |
| `emission-v3` | Émission et document v3, témoin v2, approbation et refus d'unité manquante |

Les deux phases d'émission démarrent un collecteur sentinelle local et les
gardes réseau d'offre. Les destinataires sont des fixtures `army.invalid`,
les PDF reçus sont relus avec assertions métier. Les données préparées ne
prouvent pas le parcours : les montants, états et téléchargements finaux
restent vérifiés par les scénarios.

## Limites de sélection conservées

La configuration garde `knownRedAtBase` pour des scénarios rouges sur la base
historique `98408ef0`. Leur exclusion reste visible dans les manifestes ; ce
nettoyage documentaire ne les requalifie ni ne change leurs attentes.

| Scénario hors sélection par défaut | Cause enregistrée sur cette base |
| --- | --- |
| GR01 | Requête forgée sans `operationKey` / `expectedUpdatedAt`, refusée par validation avant le conflit de session attendu |
| GR03 | Oracle d'erreur exact omettant `status` dans l'objet renvoyé |
| GR05 | Attente réseau capturant une réponse synthétique tardive du parcours ; résultat intermittent |
| GR07 de `resume` | Rejet forgé sans `versionId` / `draftLockSessionId` et statut HTTP insuffisant pour prouver le rejet |
| GR09 | Oracle MO attendant `labor_role_id: null` alors que le rôle préféré est persisté |
| OF03 de `emission` | En-tête attendu « P.U. HT » / « Prix unitaire » différent du « PU HT » rendu |

Les reproduire avec `--phase resume --grep '^GR01\s'` ou la phase concernée,
puis diagnostiquer sur le code actuel. Une campagne verte par défaut prouve
uniquement les scénarios sélectionnés. Les autres variantes d'émission (`PDFL`,
`EF`, `NF`) restent opt-in par filtre.

## CI et preuve

Le [workflow calc-v3](../../.github/workflows/e2e-army-calc-v3.yml) exécute le
plan nocturne en phases séparées ; le lancement manuel permet `nightly`, `all`
ou une phase. Le plan et les nombres de résultats viennent de la configuration,
pas d'un total recopié ici. Un changement de ce workflow déclenche aussi sa
validation sur PR.

La campagne conserve sous `.e2e/army/ci/` son manifeste, les preuves de pile et
build, les phases, rapports et artefacts métier expurgés. Les phases d'émission
ajoutent les reçus du collecteur et PDF contrôlés. Un build, un setup ou un
collecteur en échec n'est pas une réussite métier ; une preuve réutilisée n'est
pas une exécution nouvelle. Les rapports anciens restent accessibles dans Git.
