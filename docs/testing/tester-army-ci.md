# TesterArmy en CI

Les workflows et les fichiers de sélection sont la source des protections
actuelles. Ce guide décrit leur rôle ; il n'atteste aucun résultat distant.
Pour exécuter un parcours, commencer par [le guide des tests](../../e2e/README.md).

## Workflows

| Workflow | Déclenchement et portée |
| --- | --- |
| [Quality Gate](../../.github/workflows/quality-gate.yml) | PR vers `main`, push `main`, manuel ; contrôles statiques, tests retenus et build de production, puis agrégation `quality-gate` |
| [Smoke anonyme](../../.github/workflows/e2e-army-smoke.yml) | PR, push `main`, manuel ; configuration publique synthétique, aucun backend partagé ni modèle |
| [Critical](../../.github/workflows/e2e-army-critical.yml) | PR vers `main`, push `main`, manuel ; sélection métier et métré, piles natives indépendantes, checks `army-critical` et `army-takeoff` |
| [E2E RLS Matrix](../../.github/workflows/e2e-rls-matrix.yml) | Chaque PR vers `main` et manuel ; étapes lourdes selon chemins DB/runtime ; lancement manuel complet |
| [Full](../../.github/workflows/e2e-army-full.yml) | Manuel et quotidien à 03:15 UTC ; parcours de production et phase développement |
| [Calc-v3](../../.github/workflows/e2e-army-calc-v3.yml) | Manuel, quotidien à 04:45 UTC et PR modifiant ce workflow ; phases du [guide calc-v3](tester-army-calc-v3.md) |

Les commandes locales ne modifient ni les règles de protection de `main` ni
les vérifications obligatoires. Un check agrégé réussi avec sélection `none`
indique qu'aucun parcours n'était requis ; ce n'est pas une exécution E2E.

## Sélection par impact des parcours critical

[`select-journeys.ts`](../../scripts/tester-army/select-journeys.ts) lit
[`army-impact-map.json`](../../scripts/tester-army/army-impact-map.json), le diff
Git et le graphe des imports/appels de routes. Sur une PR, il retient les
parcours atteints. Un changement partagé, inconnu ou une erreur de sélection
élargit à la suite entière. Une modification limitée aux chemins documentaires
reconnus n'exécute aucun parcours.

Un push `main` lance la suite critical entière sauf documentation seule.
Le déclenchement manuel ou le label `army-full` force la sélection complète.
Les parcours `fullOnly` de métré sont sélectionnés sur PR ; ils ne se rajoutent
pas au push `main`, et restent couverts par la campagne full nocturne.

```sh
node scripts/tester-army/select-journeys.ts --event pull_request --base origin/main --head HEAD
npm run e2e:army:local -- --files 'e2e/army/critical/estimate-integrity.e2e.ts'
```

Le premier appel compare les commits (`base...head`), pas le travail non
commité. `--files` et `--grep` s'excluent. Avant de créer une pile,
`journey-preflight.mjs` refuse une sélection sans parcours métier, une
alternative de filtre sans correspondance et un fichier local oublié des
collecteurs ou du registre d'exclusions. Chaque fichier demandé doit ensuite
être réellement exécuté et réussi.

## Jobs parallèles

[`army-shards.json`](../../scripts/tester-army/army-shards.json) fixe le nombre
de shards, leurs workers et les durées utilisées pour répartir les fichiers.
Chaque shard possède sa base, son compte et son build ; un fichier n'est pas
coupé entre plusieurs jobs. Les shards critical utilisent 2 workers ; full et
métré restent à 1. Une sélection trop petite ou impossible à répartir conserve
un seul job. Les durées ne choisissent pas la couverture.

[`aggregate-shards.ts`](../../scripts/tester-army/aggregate-shards.ts) vérifie
les manifestes, sources, sélections, workers, résultats et empreintes de chaque
unité. L'union doit correspondre exactement au plan, hors setups explicitement
partagés. Une unité manquante, échouée, interrompue, avec tests sautés ou preuve
incohérente empêche le succès agrégé. Les agrégats conservent les preuves des
unités et leur portée `full`, `filtered-critical` ou `filtered-full`.

## Pile, confidentialité et diagnostic

[`run-tester-army-ci.ts`](../../scripts/run-tester-army-ci.ts) refuse les `.env`
et cibles DB/Supabase héritées, crée une pile native loopback et applique les
migrations du checkout. Les contrôles pgTAP/RLS précèdent les parcours ; le
build de production peut démarrer en parallèle des contrôles DB, sur la même
identité de backend. Le plafond SQL de copie n'est alors pas mesuré dans ce
job ; la matrice RLS l'exécute seule, sur chaque PR qui touche la base et
chaque nuit sur `main`. Voir les [budgets SQL](large-estimate-statement-budget.md).

Le compte/tenant ARMY et les secrets sont temporaires. Les sorties partageables
sont expurgées ; les journaux SQL privés et l'environnement natif ne sont pas
à publier. Le runner détruit sa pile en sortie, y compris après échec normal.
La [reprise locale](tester-army-local-development.md#arrêt-et-reprise) traite
les interruptions brutales et ressources orphelines.

Pour diagnostiquer un échec, lire d'abord le manifeste de campagne, la phase
échouée, son rapport exact et son journal. Une installation/build interrompu
n'est pas un résultat métier. Conserver le premier échec avant correction ; ne
pas le masquer par un retry ou un timeout augmenté. Les workflows fixent les
artefacts, délais et durées de rétention actuels.

Les fichiers `shared-supabase-*.md` restants sont des reçus historiques lus par
le garde de restamp ; leur présence protège les noms des migrations déjà
appliquées. Les autres documents de recettes encore présents sont référencés
par des scripts ou le registre de parcours hors sélection. Ce ne sont pas des
manuels de configuration actuels ni des preuves fraîches.
