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
| [E2E RLS Matrix](../../.github/workflows/e2e-rls-matrix.yml) | Chaque PR vers `main`, push `main` qui touche `supabase/` ou la matrice, quotidien à 05:15 UTC et manuel ; étapes lourdes d'une PR selon chemins DB/runtime ; les autres lancements sont complets |
| [Full](../../.github/workflows/e2e-army-full.yml) | Manuel et quotidien à 03:15 UTC ; parcours de production et phase développement |
| [Calc-v3](../../.github/workflows/e2e-army-calc-v3.yml) | Manuel, quotidien à 04:45 UTC et PR modifiant ce workflow ; phases du [guide calc-v3](tester-army-calc-v3.md) |
| [CI night alert](../../.github/workflows/ci-night-alert.yml) | Après chaque campagne planifiée Full ou Calc-v3, et manuel ; [ticket d'alerte](#alerte-des-campagnes-planifiées) ouvert, commenté ou fermé |

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

## Avant un push direct sur main

Un push `main` lance la suite critical seule. Les parcours du métré et les phases
calc-v3 attendent sinon une PR ; la phase développement et les parcours
`extended` ne tournent que dans la campagne Full planifiée. Un changement poussé
directement prouve donc sur le poste, avant le push, ceux qu'il atteint.

```sh
npm run e2e:army:reach
```

[`reach.ts`](../../scripts/tester-army/reach.ts) compare l'arbre de travail
(commits, modifications et fichiers non suivis) à `origin/main` avec la sélection
d'une PR, puis affiche la commande locale de chaque suite :

- « mapped to the change » : une règle relie le changement à ces parcours ou
  phases ; ils sont à lancer ;
- « every journey » ou « every phase » : repli de la sélection sur un chemin
  partagé ou inconnu de la carte. Une PR lancerait tout en parallèle ; sur le
  poste, lancer ce que le changement peut modifier et citer le reste au rapport ;
- phase développement : elle pilote le même hub d'affaire que les parcours du
  métré et les suit ; aucune règle ne la relie à un fichier source ;
- parcours `extended` : seuls les fichiers de parcours modifiés sont listés ; un
  changement applicatif qui les casse n'est vu que par la campagne planifiée et
  son [alerte](#alerte-des-campagnes-planifiées).

## Alerte des campagnes planifiées

Une campagne planifiée rouge sur `main` n'apparaît sur aucune PR.
[`ci-night-alert.yml`](../../.github/workflows/ci-night-alert.yml) s'exécute
après chaque campagne planifiée « TesterArmy Full » et « TesterArmy calc-v3 » et
tient un ticket GitHub par workflow, titré « CI nocturne rouge : <workflow> » :

- campagne rouge : le ticket est ouvert, ou reçoit un commentaire s'il l'est
  déjà. Il cite le run, ses jobs en échec et les parcours non passés que nomme
  `notPassed` dans le manifeste agrégé (rapports des shards et des phases
  calc-v3) ; un échec antérieur aux parcours n'en nomme aucun ;
- première campagne verte : le ticket est commenté puis fermé ;
- campagne annulée ou sans conclusion : rien n'est écrit.

Seuls les tickets ouverts par le workflow lui-même sont reconnus : le dépôt est
public et n'importe qui peut ouvrir un ticket du même titre. La variable de dépôt
facultative `CI_ALERT_ASSIGNEES` (identifiants séparés par des virgules) assigne
les nouveaux tickets ; sans elle, seuls les abonnés aux tickets du dépôt sont
notifiés. Une alerte qui échoue elle-même laisse un run « CI night alert » rouge.

Le déclenchement manuel rejoue l'alerte d'un run donné. Il n'écrit que si
l'option d'écriture est cochée et que ce run est une campagne planifiée ; sinon
la décision est seulement affichée dans le résumé du job.

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
échouée, son rapport exact et son journal ; l'erreur finale du lanceur en cite
déjà la cause ([port applicatif et cause d'un
échec](tester-army-local-development.md#port-applicatif-et-cause-dun-échec)).
Une installation/build interrompu n'est pas un résultat métier. Conserver le premier échec avant correction ; ne
pas le masquer par un retry ou un timeout augmenté. Les workflows fixent les
artefacts, délais et durées de rétention actuels.

Les fichiers `shared-supabase-*.md` restants sont des reçus historiques lus par
le garde de restamp ; leur présence protège les noms des migrations déjà
appliquées. Les autres documents de recettes encore présents sont référencés
par des scripts ou le registre de parcours hors sélection. Ce ne sont pas des
manuels de configuration actuels ni des preuves fraîches.
