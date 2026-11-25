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
| [E2E RLS Matrix](../../.github/workflows/e2e-rls-matrix.yml) | Chaque PR vers `main`, chaque push `main` qui ne touche pas que la documentation, quotidien à 05:15 UTC et manuel ; toujours complet ; sur une PR et sur un push `main` il porte seul pgTAP et la matrice RLS, que les jobs Army lui délèguent |
| [Full](../../.github/workflows/e2e-army-full.yml) | Manuel, quotidien à 03:15 UTC et [après un push `main`](#campagnes-de-main-après-un-push) ; parcours de production et phase développement |
| [Calc-v3](../../.github/workflows/e2e-army-calc-v3.yml) | Manuel, quotidien à 04:45 UTC, PR vers `main` (phases atteintes) et [après un push `main`](#campagnes-de-main-après-un-push) ; phases du [guide calc-v3](tester-army-calc-v3.md), réparties en [groupes](#jobs-parallèles), check `army-calc-v3` |
| [CI night alert](../../.github/workflows/ci-night-alert.yml) | Après chaque campagne Full ou Calc-v3 et chaque run E2E RLS Matrix de `main` (planifié ou après un push), et manuel ; [ticket d'alerte](#alerte-des-campagnes-de-main) ouvert, commenté ou fermé |
| [Dependency audit alert](../../.github/workflows/dependency-audit-alert.yml) | Quotidien à 05:45 UTC et manuel ; [audit npm de `main`](#audit-des-dépendances), ticket ouvert, commenté ou fermé |

Le job **Build** exécute `npm run verify:production` sur les PR, sur `main` et
sur demande. Il compile avec Webpack, vérifie les types Next.js, les budgets et
les composants PDF, Excel et Word du paquet, puis démarre le serveur pour les
vérifications HTTP. Le contrôle requis `quality-gate` échoue si ce job n'aboutit
pas. La commande de Vercel exécute `npm run build:compile` avec
`MERGEONE_SKIP_BUILD_TYPECHECK=1` pour assembler le déploiement. GitHub Actions
garde la vérification des types Next.js. Avant un déploiement
manuel, vérifier le succès de `quality-gate` sur le commit déployé.

Les commandes locales ne modifient ni les règles de protection de `main` ni
les vérifications obligatoires. Un check agrégé réussi avec sélection `none`
indique qu'aucun parcours n'était requis ; ce n'est pas une exécution E2E.

## Sélection par impact des parcours critical

[`select-journeys.ts`](../../scripts/tester-army/select-journeys.ts) lit
[`army-impact-map.json`](../../scripts/tester-army/army-impact-map.json), le diff
Git et le graphe des imports/appels de routes. Les parcours de la suite et du
métré viennent des sélections de
[`journey-selections.mjs`](../../scripts/tester-army/journey-selections.mjs),
celles que lance `e2e.config.ts`, appliquées à l'arbre de travail : la carte
n'en garde aucune liste. Un parcours qu'aucune règle de la carte n'atteint
élargit la sélection à la suite entière. Sur une PR, il retient les
parcours atteints. Un changement partagé, inconnu ou une erreur de sélection
élargit à la suite entière. Une modification limitée aux chemins documentaires
reconnus n'exécute aucun parcours.

Un push `main` lance la suite critical entière sauf documentation seule, une
suite à la fois : [la plus récente attend et remplace une plus ancienne en
attente](#campagnes-de-main-après-un-push).
Le déclenchement manuel ou le label `army-full` force la sélection complète.
Les parcours `fullOnly` de métré sont sélectionnés sur PR ; ils ne se rajoutent
pas au run Critical d'un push `main`, et restent couverts par la campagne Full
[qui suit le push](#campagnes-de-main-après-un-push) et par la campagne nocturne.

```sh
node scripts/tester-army/select-journeys.ts --event pull_request --base origin/main --head HEAD
npm run e2e:army:local -- --files 'e2e/army/critical/estimate-integrity.e2e.ts'
```

Les phases calc-v3 d'une PR sont choisies par
[`select-calc-v3.ts`](../../scripts/tester-army/select-calc-v3.ts) sur le même
graphe. Un fichier modifié lance les phases dont un parcours le charge et celles
de sa règle de domaine. Chaque point d'entrée qu'il atteint doit être expliqué :
une page ou une route qu'aucune phase ni règle ne couvre lance toutes les phases,
même si le parcours d'une phase atteint aussi le fichier. Aucune phase ne tourne
pour un changement qu'aucune phase ne charge : tests unitaires, parcours des
autres suites, outillage et workflows que la carte classe `nonRuntime`. Sous
`src/`, seuls les tests unitaires (`*.test.ts`, `*.test.tsx`) sont dans ce cas :
le build de chaque phase vérifie les types du reste, et la préparation de la pile
en lance ou en lit une partie par chemin. Lancent toujours toutes les phases : le
workflow et le profil calc-v3, la matrice RLS et `vitest.config.ts`,
`openapi.json`, du code applicatif qui n'atteint aucune phase, et un fichier
supprimé.

Le premier appel compare les commits (`base...head`), pas le travail non
commité. `--files` et `--grep` s'excluent. Avant de créer une pile,
`journey-preflight.mjs` refuse une sélection sans parcours métier, une
alternative de filtre sans correspondance et un fichier local qu'aucune
sélection (`journey-selections.mjs`, phases calc-v3) ni le registre
d'exclusions ne retient. Chaque fichier demandé doit ensuite
être réellement exécuté et réussi.

## Filtre par modèle de décision

Sur une PR, un modèle de décision réduit la sélection par impact : il lit le
diff et estime, pour chaque parcours retenu, la probabilité que le changement
le touche. Les fichiers de parcours dont il écarte tous les tests ne lancent
aucun job. C'est le filtre natif du runner e2e
([Test filters](https://e2e.com/docs/filters), paquet `@e2e-dev/decision`),
derrière le nôtre. Il ne fait que retirer des parcours ; il n'en ajoute jamais.

Le job `army-select` enchaîne trois étapes, la première sans installation :

1. `select-journeys.ts` sélectionne par impact, comme ci-dessus. Une sélection
   vide s'arrête là.
2. [`decision-listing.ts`](../../scripts/tester-army/decision-listing.ts) fait
   lister les parcours retenus par le runner avec `--changed-since <base>` :
   les filtres de `e2e.config.ts`
   ([`impact-filter.ts`](../../scripts/tester-army/impact-filter.ts)) jugent le
   changement, le modèle en dernier.
3. `select-journeys.ts --decision` replanifie les jobs sans les fichiers écartés.

Le résumé du job liste chaque parcours écarté avec l'avis du modèle, et
`selection.json` les conserve sous `decision`.

| Garde | Effet |
| --- | --- |
| Événement autre qu'une PR, label `army-full` (pris en compte au push suivant), sélection forcée ou de repli | Le modèle n'est pas interrogé |
| Chemin qui fait tourner toute la suite par impact : le cœur partagé de la carte (globs `full` : dépendances, `e2e.config.ts`, fixtures partagées, runner, layout, auth, moteur de calcul, migrations), ce que le runner ou le cœur partagé charge, ou un chemin que la carte ne connaît pas | Le modèle n'est pas interrogé : les dépendances ne sont pas installées, et la sélection par impact (toute la suite) est conservée |
| Carte d'impact modifiée au-delà de ses règles (globs `full`, `docs`, `nonRuntime`, suites, groupes) | Le modèle ne juge rien. Quand seules les règles changent, celles de la base comptent aussi dans le plancher |
| Parcours qu'une règle de la carte lie directement à un fichier modifié | Toujours exécuté |
| Avis de 8 % ou plus, ou avis illisible | Parcours exécuté (le filtre d'origine écarte sous 20 %) |
| Diff de plus de 60 kB, fichier de parcours trop gros pour être joint au diff | Le modèle ne juge pas : les parcours concernés tournent |
| Clé absente (fork, Dependabot), panne du modèle, erreur d'une des trois étapes | La sélection par impact est conservée telle quelle |

Le modèle ne voit que ce qui peut changer le comportement de l'application : la
documentation, les tests unitaires, les types générés et les autres chemins
`nonRuntime` de la carte sont retirés du changement qu'il lit, ce qui garde
davantage de PR sous la limite de 60 kB.

Ce filtre est probabiliste : une régression peut passer une PR parce que le
parcours qui l'aurait montrée a été écarté. Le filet est la suite complète
lancée [après chaque push `main`](#campagnes-de-main-après-un-push). Sur une PR
à risque, poser le label `army-full` fait tourner tous les parcours. Un check
vert sur une PR prouve donc les parcours listés dans le résumé de sélection,
pas la suite entière.

La clé du modèle (`ARMY_DECISION_FILTER_API_KEY`, modèle `gpt-6-luna`) est le
seul secret des workflows Army. Elle n'est donnée qu'à l'étape 2, dans un job
qui ne lance ni pile ni parcours, et seulement quand la sélection interroge le
modèle. Le code de la PR s'y exécute toutefois : `e2e.config.ts`, fichiers de
parcours, scripts de sélection, et l'arbre de dépendances qu'elle installe. Une
PR qui change les dépendances ou l'infrastructure n'interroge jamais le modèle
et ne reçoit donc pas la clé. Une PR d'une branche du dépôt qui change le code
de l'application peut, elle, la lire. Les parcours eux-mêmes restent sans modèle.

Coût : une PR interrogée lance deux listages (critical et takeoff), chacun par
lots d'environ 80 kB de diff, avec plusieurs appels au modèle. Chaque push en
relance autant. Le filtre s'arrête après trois appels en échec ; il n'a pas
d'autre plafond de dépense.

Aperçu local, sans le modèle puis avec lui (commiter d'abord : le modèle ne lit
que les commits) :

```sh
E2E_ARMY_SUITE=critical NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  npx e2e list --tag critical --exclude-tag agent --changed-since origin/main
E2E_ARMY_DECISION_FILTER=1 ARMY_DECISION_FILTER_API_KEY=… E2E_ARMY_SUITE=critical \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  npx e2e list --tag critical --exclude-tag agent --changed-since origin/main
```

Mesure du 12/11/2026, rejeu sur 16 PR fusionnées dont le diff utile tient sous
60 kB : 47 285 s de parcours critical retenus par impact, 33 667 s après le
filtre (−29 %). Les PR plus grosses (14 des 45 dernières) et celles qui touchent
l'infrastructure ne gagnent rien. Les phases calc-v3 ne sont pas filtrées.

## Check rouge sur une pull request

Les runners sont partagés par toutes les pull requests et par `main`. Un
nouveau push relance tous les checks de la pull request ; une relance ne
reprend que les jobs en échec. Chercher la cause avant de réagir :

| Cause du rouge | Indice | Réaction |
| --- | --- | --- |
| Le changement de la pull request | Le parcours échoue avec le diff et passe sans lui | Corriger, puis pousser une fois |
| Panne d'infrastructure ou parcours instable | Échec d'installation, de téléversement d'artefact ou de démarrage ; parcours vert sur le même commit ailleurs | Le noter dans la pull request avec la preuve, puis `gh run rerun <run-id> --failed`, sans nouveau commit |
| Rouge hérité de `main` | Le même parcours est rouge sur `main` ([ticket d'alerte](#alerte-des-campagnes-de-main) ou dernier run Critical de `main`) | Le noter dans la pull request, attendre le correctif sur `main`, puis fusionner `origin/main` une seule fois |

Une relance rejoue le commit de fusion calculé au moment du push : elle ne
voit pas un correctif arrivé ensuite sur `main`. C'est le seul cas où une
fusion de `origin/main` répond à un rouge.

`main` n'exige pas une branche à jour pour fusionner. Fusionner `origin/main`
sans conflit signalé par GitHub, ou cliquer « Update branch », relance tous les
checks sans rien qualifier de plus.

## Campagnes de main après un push

Le run Critical d'un push `main` ne lance ni les parcours du métré, ni les
parcours `extended`, ni la phase développement, ni les phases calc-v3. Les
workflows Full et Calc-v3 suivent donc chaque push `main` qui ne touche pas
que la documentation, en entier mais bornés : le compte exécute 20 jobs à la
fois et une journée chargée compte plus de vingt push.

- Une campagne à la fois par workflow : tous les push partagent un groupe de
  concurrence qui n'annule rien. Une campagne tourne, la plus récente attend et
  remplace une plus ancienne en attente, dont elle contient les commits. Le run
  remplacé apparaît « cancelled » ; ce n'est pas un échec.
- Deux jobs de parcours à la fois par campagne (`max-parallel`), plus le job
  développement de Full : au plus cinq des 20 jobs, quel que soit le nombre de
  push.
- Un push de documentation seule (`docs/**`, `**/*.md`, les chemins `docs` de la
  carte d'impact) ne démarre aucune campagne et n'en remplace aucune.
- pgTAP et la matrice RLS d'un push tournent une seule fois, dans le run
  `rls-matrix` de ce push, comme sur une pull request : les jobs Critical,
  Full et Calc-v3 du push les lui délèguent
  ([détail](#pile-confidentialité-et-diagnostic)). `rls-matrix` suit les mêmes
  push (même `paths-ignore`) ; chaque run de push a son propre groupe de
  concurrence, si bien qu'aucun push plus récent ne l'annule ni ne le remplace.

Le run Critical d'un push suit la même file depuis le 11/11/2026, à sa largeur
habituelle (ses shards tournent ensemble) : un run tourne, le plus récent attend
et remplace un plus ancien en attente, et un push de documentation seule n'en
démarre aucun. Chaque run joue la suite critical entière, donc celui qui reste
couvre les commits de ceux qu'il remplace. Avant, chaque push gardait le sien :
le soir du 11/11/2026, après quinze fusions en deux heures, dix runs Critical
de `main` étaient ouverts en même temps à 23 h 25 UTC, celui du push de 22 h 04
n'avait pas fini 81 minutes plus tard, et les contrôles des pull requests
attendaient derrière eux.

Le résultat d'un commit se lit donc sur la première campagne terminée qui le
contient : environ 45 minutes après le push (première campagne mesurée, le
10/11/2026 : Full 40 minutes, Calc-v3 46 minutes avec un job par phase),
davantage derrière une campagne déjà en cours. Depuis, les phases calc-v3
tournent en cinq groupes, deux à la fois : une trentaine de minutes d'après les
durées de `army-shards.json`, estimation que la première campagne groupée
remplacera par sa mesure. Une campagne rouge, ou un run `rls-matrix` rouge,
ouvre le [ticket d'alerte](#alerte-des-campagnes-de-main).

## Avant un push direct sur main

Depuis le 11/11/2026, `main` est protégée : un push direct est refusé et tout
changement passe par une PR dont les checks requis sont verts. Cette section
s'applique donc avant d'ouvrir la PR, pour ce que ses checks n'exécutent pas :
la phase development et les parcours extended. Les parcours du métré et les
phases calc-v3 atteints tournent dans la PR.

Les campagnes qui suivent un push rendent leur verdict après coup, sur `main`.
Un changement poussé directement prouve donc sur le poste, avant le push, les
parcours hors Critical qu'il atteint.

```sh
npm run e2e:army:reach
```

[`reach.ts`](../../scripts/tester-army/reach.ts) compare l'arbre de travail
(commits, modifications et fichiers non suivis) à `origin/main` avec la sélection
d'une PR, puis affiche la commande locale de chaque suite :

- « mapped to the change » : une règle relie le changement à ces parcours ou
  phases ; ils sont à lancer ;
- « every journey » ou « every phase » : repli de la sélection sur un chemin
  partagé ou inconnu de la carte. Une PR lancerait tout, en jobs parallèles ;
  sur le poste, lancer ce que le changement peut modifier ; la campagne qui
  suit le push couvre le reste ;
- phase développement : elle pilote le même hub d'affaire que les parcours du
  métré et les suit ; aucune règle ne la relie à un fichier source ;
- parcours `extended` : seuls les fichiers de parcours modifiés sont listés ; un
  changement applicatif qui les casse n'est vu que par la campagne Full et son
  [alerte](#alerte-des-campagnes-de-main).

## Alerte des campagnes de main

Une campagne rouge sur `main` n'apparaît sur aucune PR.
[`ci-night-alert.yml`](../../.github/workflows/ci-night-alert.yml) s'exécute
après chaque campagne « TesterArmy Full » et « TesterArmy calc-v3 » de `main`,
et après chaque run « E2E RLS Matrix » de `main`, planifié ou lancé après un
push, et tient un ticket GitHub par workflow, titré
« CI rouge sur main : <workflow> ». Ce dernier porte pgTAP et la matrice RLS que
les jobs Army d'un push lui délèguent, et son run planifié est le seul qui
mesure les plafonds de requêtes sur `main` : un pgTAP rouge sur `main` arrive
donc au ticket « CI rouge sur main : E2E RLS Matrix ».

- campagne rouge : le ticket est ouvert, ou reçoit un commentaire s'il l'est
  déjà. Il cite le run, ses jobs en échec et les parcours non passés que nomme
  `notPassed` dans le manifeste agrégé (rapports des shards et des phases
  calc-v3 de chaque groupe) ; un échec antérieur aux parcours n'en nomme aucun.
  E2E RLS Matrix ne lance aucun parcours : son ticket cite le run et le job en
  échec, dont le journal donne l'étape (pgTAP, plafonds ou matrice RLS) ;
- première campagne verte : le ticket est commenté puis fermé ;
- campagne annulée ou sans conclusion : rien n'est écrit. Exception : un run
  E2E RLS Matrix de push annulé compte comme rouge, car les jobs Army de ce
  push lui ont délégué pgTAP et la matrice RLS, qui n'ont donc pas tourné pour
  cette révision ; le ticket dit que ces contrôles ont été annulés ;
- résultat dépassé : une campagne planifiée et une campagne lancée après un push
  se chevauchent. Quand une autre campagne du même workflow a déjà rendu son
  verdict sur une révision plus récente de `main`, le résultat qui arrive après
  elle n'écrit rien : il ne ferme pas le ticket d'un rouge plus récent et ne
  rouvre pas celui qu'un vert plus récent a fermé.

Les alertes d'une campagne Army passent une à une, dans l'ordre où ses
campagnes se terminent (un groupe de concurrence par workflow). E2E RLS Matrix
se termine une fois par push, en parallèle ; or un groupe ne garde qu'un run en
attente, et une alerte plus récente y annulerait la précédente, rouge
comprise. Chacune de ses alertes a donc son propre groupe : celle d'un run
dépassé n'écrit rien, et le résultat dépassé est vérifié une seconde fois juste
avant d'écrire, pour qu'un vert plus ancien ne ferme pas le ticket qu'un rouge
plus récent vient de commenter. Deux rouges simultanés peuvent ouvrir deux
tickets : le suivant commente le plus ancien, et le premier vert les ferme tous.

Seuls les tickets ouverts par le workflow lui-même sont reconnus : le dépôt est
public et n'importe qui peut ouvrir un ticket du même titre. La variable de dépôt
facultative `CI_ALERT_ASSIGNEES` (identifiants séparés par des virgules) assigne
les nouveaux tickets ; sans elle, seuls les abonnés aux tickets du dépôt sont
notifiés. Une alerte qui échoue elle-même laisse un run « CI night alert » rouge.

Le déclenchement manuel rejoue l'alerte d'un run donné. Il n'écrit que si
l'option d'écriture est cochée et que ce run est une campagne de `main`
(planifiée ou après un push) ; sinon la décision est seulement affichée dans le
résumé du job.

## Audit des dépendances

L'étape « Audit dependencies » du job Statique de Quality Gate
(`npm run audit:dependencies`) refuse tout avis `moderate`, `high` ou
`critical` qu'aucune exception active de
[`config/dependency-audit-policy.json`](../../config/dependency-audit-policy.json)
ne couvre, ainsi qu'une exception expirée ou inutilisée. Elle ne bloque que
lorsque le diff touche aux dépendances :

- une PR, quand elle modifie `package.json`, `package-lock.json`, `.npmrc`, le
  fichier des exceptions ou le code de l'audit (`src/test/dependency-audit.ts`,
  `src/test/dependency-audit-scope.ts`, `scripts/check-dependency-audit.ts`) ;
  en CI, le diff va de sa base au commit de fusion que GitHub construit, donc
  ce que `main` a changé entre-temps ne compte pas ;
- un push sur `main`, quand sa plage `before..after` modifie l'un d'eux ; un
  premier push ou un push forcé compte comme une modification ;
- toujours, hors PR et push : déclenchement manuel, `npm run verify:pr` local.

Sinon l'audit tourne quand même : ses erreurs deviennent un avertissement du
job et une ligne de son résumé, sans le faire échouer. L'étape « Verify
dependency signatures » bloque toujours. Du 16 au 23 novembre 2026, des avis
publiés contre des dépendances que la PR ne touchait pas ont mis 10 PR au
rouge, chacune pour une relance d'environ 110 minutes de runner.

[`dependency-audit-alert.yml`](../../.github/workflows/dependency-audit-alert.yml)
audite `main` chaque jour à 05:45 UTC (06:45 à Paris l'hiver) et tient le ticket
« Audit des dépendances rouge sur main », sur le modèle de
[l'alerte des campagnes](#alerte-des-campagnes-de-main) : audit rouge, le ticket
est ouvert ou commenté et liste les avis et les exceptions à revoir ; premier
audit propre, il est commenté puis fermé. Un audit qui ne peut pas s'exécuter
laisse le run rouge et n'écrit rien. Le déclenchement manuel n'écrit que si
l'option d'écriture est cochée et que la branche est `main`. La correction
(mise à jour, `overrides` ou exception datée) passe par une PR, que l'audit
bloque donc. Le job détient un jeton qui écrit des tickets : il n'installe aucun
paquet (`npm audit` lit `package-lock.json` seul) et lance le script avec `node`
sans chargeur, pour qu'aucun code tiers ne s'exécute à côté de ce jeton.

## Mise à jour du CLI Supabase

Dependabot n'ouvre pas de PR pour le paquet `supabase` (`ignore` dans
[`.github/dependabot.yml`](../../.github/dependabot.yml)) : la sienne ne modifiait
que `package.json`, et chaque job base de données ou Army la refusait
(« Supabase CLI must be exactly … », 4 runs rouges du 16 au 23 novembre 2026).
Cet `ignore` coupe aussi ses mises à jour de sécurité : un avis contre le CLI
arrive par le ticket « Audit des dépendances rouge sur main » de
[l'audit quotidien](#audit-des-dépendances).
La mise à jour se fait à la main, comme pour 3.0.0
([PR #176](https://github.com/maxlemeur/HEX_BC/pull/176)), en une PR qui change
ensemble :

1. la version exacte de `supabase` dans `package.json` et `package-lock.json` ;
2. `PINNED_SUPABASE_CLI_VERSION` et `PINNED_SUPABASE_POSTGRES_BUNDLE` dans
   [`src/test/supabase-cli.ts`](../../src/test/supabase-cli.ts) ;
3. les types générés (`npm run supabase:types`), qui notent la version du CLI ;
   puis `npm run db:ci:local` et les parcours Army qui lisent la base.

## Jobs parallèles

[`army-shards.json`](../../scripts/tester-army/army-shards.json) fixe le nombre
de shards, leurs workers et les durées utilisées pour répartir les fichiers.
Chaque shard possède sa base et son compte. Sur une PR, les shards Critical
construisent chacun leur application après la sélection. Les autres shards
servent le [build partagé du run](#pile-confidentialité-et-diagnostic) quand il
correspond à leur pile. Un fichier n'est pas coupé entre plusieurs jobs. Les
shards Critical utilisent 2 workers, ceux de Full et du métré en utilisent 1.
Une sélection trop petite ou impossible à répartir conserve un seul job. Les
durées ne choisissent pas la couverture.

Le coût estimé d'un shard en secondes est `max(durée du plus long fichier,
somme des durées / workers)`, hors préparation et login. Le plan essaie les
nombres de jobs admissibles en ordre croissant. Pour chaque nombre, il place
les fichiers authentifiés puis anonymes, par durée décroissante, sur le shard
autorisé de coût projeté le plus bas (à égalité, le moins chargé). Il retient
le premier plan dont le coût maximal tient dans `secondsPerShard / workers`,
ou dans la durée du plus long fichier si elle dépasse ce budget. À défaut, il
utilise le nombre maximal admissible. La sélection et le résumé donnent les
secondes cumulées et le coût estimé. Le coût est une borne basse de la durée
des tests, car un worker ne peut commencer le fichier suivant avant d'avoir
terminé le précédent.

Au-delà de **400 s** par fichier, la sélection signale la mesure enregistrée,
même pour un changement documentaire. L'agrégation signale aussi les mesures
du run qui franchissent ce seuil. Le test de la configuration bloque au-delà
de **600 s** (dix minutes de tests exécutés en série). Cette marge laisse
passer les variations usuelles du takeoff mesuré autour de 450 s. La liste
d'exceptions dans [file-durations.ts](../../scripts/tester-army/file-durations.ts)
accorde **1 000 s** uniquement à `e2e/army/local/chatgpt-local-intake.e2e.ts`,
mesuré jusqu'à environ 950 s avant sa découpe. Retirer cette exception quand
une mesure après découpe confirme une durée sous 600 s.

Chaque lundi à 08:35 UTC, [le workflow de mise à jour](../../.github/workflows/army-duration-refresh.yml)
cherche pour Critical et Full leur dernière campagne verte de main (push ou
planification) avec agrégat encore disponible. Le script vérifie le SHA du
run et des rapports, somme les tests sélectionnés réussis en une tentative
et arrondit chaque fichier à la seconde supérieure. Il ignore le login répété,
les fichiers incomplets et ceux modifiés depuis la mesure. Critical a priorité
pour les fichiers communs. Un fichier nouveau, un passage de seuil dans un
sens ou dans l'autre, ou un écart d'au moins **10 s et 20 %** met à jour la
durée et son entrée `measured`. La branche `automation/army-duration-refresh`
porte une seule PR pour ces écarts. Le résumé et l'artefact
`army-duration-proposal` restent disponibles sept jours si la création de PR
échoue. Le jeton intégré demande `contents: write` et `pull-requests: write` ;
activer **Allow GitHub Actions to create and approve pull requests** dans
Settings → Actions → General si le dépôt refuse cette création. Approuver les
workflows de la PR si GitHub en demande l'autorisation.

`neverTogether` liste les fichiers qui ne partagent jamais un shard, quelles que
soient leurs durées : les cinq fichiers des
[parcours ChatGPT local](chatgpt-local.md#vérification) démarrent chacun un
serveur de développement. Deux de ces serveurs compileraient à froid en même
temps sur un seul runner. Le plan réserve un shard à chacun des fichiers
sélectionnés de ce groupe. Le lanceur applique la même
règle à une exécution filtrée (`--files`, `--grep`) : avec plus d'un worker, il
la refuse avant de créer la pile. Sans durées utilisables, le plan n'a qu'un
shard et la règle ne s'applique pas ; l'exécution de la suite entière dans un
seul job, repli d'une sélection impossible, ne les sépare pas non plus.

Les phases calc-v3 sélectionnées tournent en groupes : autant de jobs que leurs
secondes de parcours mesurées en remplissent à `calcV3.secondsPerGroup`
(480 s), jamais plus que de phases ni que `calcV3.maxGroups` (cinq). Trois
phases courtes partagent ainsi un job. Chaque job `army-calc-v3 group N/T` prépare une seule pile et sert
un seul build, puis exécute ses phases l'une après l'autre
(`run-tester-army-ci.ts calc-v3 --phase A,B`), chacune avec ses fixtures et son
invocation TesterArmy ; une phase rouge n'arrête pas les suivantes du groupe.
[`select-calc-v3.ts`](../../scripts/tester-army/select-calc-v3.ts) répartit les
phases de la plus longue à la plus courte sur le groupe le moins chargé,
d'après les secondes de parcours mesurées par phase (`calcV3.seconds`, hors
préparation de la pile) ; une phase n'est pas coupée et aucun groupe n'est
vide. La même sélection donne toujours la même répartition. Les 19 phases
(environ 1 800 s de parcours) tournent en quatre jobs d'environ 7 min 30 de
parcours chacun, plus la préparation. Le déclenchement manuel `all`
garde la campagne complète dans un seul job, et une phase explicite le sien.

[`aggregate-shards.ts`](../../scripts/tester-army/aggregate-shards.ts) vérifie
les manifestes, sources, sélections, workers, résultats et empreintes de chaque
unité. L'union doit correspondre exactement au plan, hors setups explicitement
partagés. Une unité manquante, échouée, interrompue, avec tests sautés, avec un
parcours réussi seulement à sa [seconde tentative](#tentative-unique-et-quarantaine)
ou une preuve incohérente empêche le succès agrégé. Pour calc-v3, les unités sont les
groupes : le manifeste et la campagne de chaque groupe doivent lister ses phases
prévues, toutes réussies, et les groupes ensemble exécuter chaque phase
sélectionnée une seule fois ; une phase manquante, en double ou hors plan est
nommée. Les agrégats conservent les preuves des unités et leur portée `full`,
`filtered-critical`, `filtered-full` ou `calc-v3`.

## Tentative unique et quarantaine

Deux mécanismes aident à lire un check rouge. Aucun ne rend vert un parcours
qui échoue.

### Une seconde tentative, en CI seulement

Dans les campagnes Critical, Full (shards du métré et phase développement
compris) et Calc-v3 lancées par un workflow, un parcours en échec est rejoué
une fois. `run-tester-army-ci.ts` le décide d'après son propre environnement
(`CI` défini, autre que `false` ou `0`) : il passe toujours `CI=1` au runner
e2e, même sur le poste. Un lancement local, la boucle de développement,
l'exploration, le smoke et les recettes locales gardent zéro retry, et aucune
valeur supérieure à un n'est acceptée.

| Tentatives d'un parcours | Check | Libellé dans l'erreur du job et le résumé |
| --- | --- | --- |
| Réussite à la première | vert | aucun |
| Échec, puis réussite | rouge | `intermittent: <fichier> > <titre> (failed on attempt 1, passed on attempt 2)` |
| Deux échecs | rouge | `failed: <fichier> > <titre> (failed on both attempts: <erreur>)` |

Le runner e2e sort en code 0 et note le run `passed` quand un parcours n'a
réussi qu'à sa seconde tentative (son statut `flaky`). Plusieurs contrôles
le gardent rouge, chacun de son côté : pour les suites critique et complète,
`run-tester-army.mjs`, la validation de `run-tester-army-ci.ts` et
l'agrégation ; pour calc-v3, qui appelle le runner sans `run-tester-army.mjs`,
la validation de chaque phase et l'agrégation. Un parcours ne déclare pas ses
propres `retries` (seul `0` est admis, pour un parcours à ne jamais rejouer). La
ligne `TesterArmy CI error` du job, l'annotation et la section « Parcours non
passés » du check agrégé nomment chaque parcours avec son libellé
([`journey-outcomes.ts`](../../scripts/tester-army/journey-outcomes.ts)) ; le
ticket d'[alerte](#alerte-des-campagnes-de-main) les reprend.

« Intermittent » classe l'échec ; il ne disculpe pas le changement testé. La
seconde tentative repart de l'état que la première a laissé (affaire créée,
bail déjà pris, cache chaud) : un échec déterministe sur un état neuf peut y
réussir, et un parcours intermittent peut y échouer deux fois sur une fixture
consommée. Avant de relancer le job, la preuve attendue reste celle de
`AGENTS.md` : le même parcours rouge ou intermittent sur `main`, ou en échec
sans le diff. Relancer jusqu'au vert, ajouter des retries et allonger un
timeout restent interdits.

La seconde tentative ne tourne qu'après un échec : une campagne verte n'en a
exécuté aucune, et ses comptes, ses preuves et sa durée sont ceux d'avant. Une
campagne où tout échoue double au plus le temps de ses parcours, sous le même
plafond `maxDuration` (30 minutes pour critical et la phase développement, 60
pour full, 15 à 60 par phase calc-v3), au-delà duquel le run est interrompu,
donc rouge. Chaque tentative garde ses preuves sous `results/<test>/attempt-<n>/`.

### `test.fail`, une quarantaine déclarée

`test.fail` (e2e 0.23) marque un parcours attendu en échec : son échec est
compté `passed`, sa réussite fait échouer le run (`UNEXPECTED_PASS`). Il n'est
admis que pour un parcours rouge sur `main`, le temps de sa réparation, avec
une raison littérale qui cite un ticket ouvert : identifiant Linear (`TI-681`)
ou ticket GitHub (`#123`).

```ts
test("EI13 exporte le PDF", { tags: ["critical"], fail: "TI-681 : export PDF cassé sur main" }, async ({ app }) => {
  // parcours inchangé
});
```

- Formes admises : l'option `fail: "<ticket> : raison"` ou, dans le corps,
  `test.fail("<ticket> : raison")` et `test.fail(condition, "<ticket> : raison")`.
  `test.fail(titre, fn)` et `fail: true` n'ont pas de raison : ils sont refusés.
- [`check-journey-declarations.ts`](../../scripts/tester-army/check-journey-declarations.ts)
  (`check:army-recipes`) refuse dans `verify:pr` tout `test.fail` de `e2e/` sans
  ticket dans une raison littérale, et tout `retries` autre que `0` sur un
  parcours. Une campagne qui exécute un parcours attendu en échec sans ticket
  est rouge elle aussi, agrégation comprise.
- Chaque campagne liste les parcours en quarantaine qu'elle a exécutés, avec
  leur ticket : ligne `TesterArmy CI quarantine` du job, avertissement
  « TesterArmy quarantine » et section « Parcours en quarantaine » du résumé du
  check agrégé, clé `quarantined` des manifestes. Une PR ne liste que ceux que
  sa sélection atteint ; les campagnes de `main` les listent tous.
- Un parcours en quarantaine ne prouve rien : n'importe quel échec de test le
  satisfait, pas seulement celui du ticket. La marque se retire avec la
  correction ; le jour où le parcours passe, le check devient rouge jusqu'à son
  retrait. Rien ne vérifie que le ticket cité est encore ouvert.
- La marque ne couvre ni une erreur d'infrastructure, ni une interruption, ni
  un setup de connexion : ils restent des échecs. Un parcours en quarantaine
  qui réussit à une tentative et échoue à l'autre est rouge, avec le libellé
  `intermittent: … (passed on attempt 1 although quarantined, failed as
  expected on attempt 2)`.

## Pile, confidentialité et diagnostic

[`run-tester-army-ci.ts`](../../scripts/run-tester-army-ci.ts) refuse les `.env`
et cibles DB/Supabase héritées, crée une pile native loopback et applique les
migrations du checkout. Les contrôles pgTAP/RLS précèdent les parcours ; le
build de production peut démarrer en parallèle des contrôles DB, sur la même
identité de backend. Le plafond SQL de copie n'est alors pas mesuré dans ce
job ; la matrice RLS l'exécute seule, sur chaque PR, chaque push `main` et
chaque nuit. Voir les [budgets SQL](large-estimate-statement-budget.md).

Chaque pile migre par `db reset`. Jusqu'au 24/11/2026, les shards Critical et
takeoff restauraient une base pré-migrée (pg_dump puis pg_restore, mise en
cache par `main`) au lieu de `db reset`, pour gagner 6 à 8 s par job (environ
3 s de restauration contre 8 à 13 s de reset). Une base restaurée ne se
comportait pas comme une base issue de `db reset` : du 21/11 au 23/11, 22 runs
Critical de `main` sont tombés sur pgTAP seul, sur une base restaurée
(`takeoff-plan-locations` 20 fois, nettoyage bloqué par la clé étrangère
`audit_logs_tenant_id_fkey`, corrigé par #502 ; puis
`copied-takeoff-draft-delete.sql` 2 fois, `ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED`),
alors que les mêmes tests passaient sur les mêmes révisions après `db reset`
(Full, calc-v3 et `rls-matrix` des PR). Cause probable : pg_restore renumérote
les OID, donc les noms `RI_ConstraintTrigger_a_<oid>`, et avec eux l'ordre
dans lequel les cascades se déclenchent. Le gain ne valait pas une base qui
diffère de celle que vérifient les autres checks : l'instantané a été retiré,
sans interrupteur.

Dans chaque workflow Army, un job de build (`army-build` en Critical,
`army-calc-v3-build`, `army-full-build`) construit l'application de production
une seule fois, en parallèle du job de sélection ou de plan, avec
[`army-build.ts`](../../scripts/tester-army/army-build.ts). Le build fige
l'origine du backend et la clé anon (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Avec la CLI épinglée et
`supabase/config.toml`, la clé anon d'une pile native ne change pas d'une pile
à l'autre (deux piles de ports différents le 24 novembre 2026), mais son port
API est tiré au hasard. Le job démarre donc une pile nue, sans migration, donnée
ni compte, pour lire son origine et sa clé, et la garde pendant le build comme
un shard. Il publie la sortie (`.build/tester-army/next` sans `cache`, `dev`,
`diagnostics`, `types`, `trace` ni `trace-build`), le manifeste et le journal
du build et `prebuilt.json` dans l'artefact `army-prebuilt-build`, gardé un
jour ; une sortie qui contiendrait la clé de service ou le secret de reprise
n'est pas publiée. Ce job restaure le cache Next ; celui de Critical le
sauvegarde sur un push de `main`. Sur une PR, `army-build` construit pour le
métré quand la sélection par impact atteint ses parcours. Les shards Critical
démarrent dès que `army-select` termine. Chacun restaure le cache Next et
compile pour sa propre pile dès que son URL et ses clés sont disponibles,
pendant le `db reset` et la vérification du schéma. Calc-v3 construit seulement
si une phase sélectionnée tourne sous `next start`. Dans Full, seuls les shards
de production utilisent le build partagé.

Chaque shard ou groupe qui utilise le build partagé télécharge l'artefact, sans
échouer s'il manque, et demande pour sa pile le port API du build quand il est libre. Il restaure
toujours le cache Next, même à côté d'un build téléchargé : un build refusé se
reconstruit à chaud. Le runner applique ensuite la règle de [`prebuilt-build.ts`](../../scripts/tester-army/prebuilt-build.ts) :
- mêmes révision, empreinte du diff et entrées que le checkout (`buildSourceEvidence`) ;
- build réussi avec les commandes enregistrées, sources stables pendant le build ;
- mêmes origine et clé anon que la pile du shard (la clé par son empreinte) ;
- mêmes Node, plateforme et architecture ;
- une fois posés les seuls fichiers que liste le manifeste, empreinte de sortie (`buildOutputEvidence`) égale à la sienne.

Au premier écart, il retire les fichiers posés et construit localement comme
avant, en disant pourquoi dans le journal (`TesterArmy CI: building here, …`)
et dans le manifeste. Le manifeste du shard indique `build.source` : `prebuilt`,
avec l'artefact, le run, le manifeste du build et son empreinte (conservés sous
`builds/`), ou `local`, avec la raison `prebuiltRefused`. Un build téléchargé
puis refusé ajoute aussi l'annotation `Army build not reused` au run, avec la
raison : si tous les shards refusent (une montée de la CLI Supabase qui change
la clé anon ou les ports, par exemple), le run coûte plus qu'avant sans devenir
rouge, et seule cette annotation le signale. Un artefact absent reste une ligne
du journal. Un job de build en échec ou absent ne fait jamais échouer un shard :
celui-ci construit lui-même. Le job de build est en `continue-on-error` : son
échec laisse le run vert (`ci-night-alert` lit la conclusion du run) et sa
dernière étape l'annonce par l'annotation `Army build failed`. Son étape de
build a sa propre limite de 15 minutes, sous les 25 du job, pour qu'un build
bloqué échoue avant le job et que l'annotation sorte.
La vérification d'un build lancé tôt (même origine et même clé que la pile du
shard) reste inchangée.

pgTAP et la matrice RLS prouvent la base migrée, pas les parcours : le même
résultat dans chacune des piles d'une PR ou d'un push `main`. Sur une pull
request et sur un push `main`, ils tournent donc une seule fois, dans
`rls-matrix`, seuls sur leur pile et plafonds compris : environ 2,7 min de
moins par job Army, soit, sur un push `main`, pour chacun des cinq shards
Critical, des six shards Full, du job développement et des groupes calc-v3. Ce check, requis sur
les PR, tourne en entier sur toute PR, de documentation aussi : le label
`army-full` ou un diff vide lancent des jobs Army sur une telle PR. Sur `main`,
il suit chaque push pour lequel les workflows Army tournent (même
`paths-ignore`) et aucun run de push n'est annulé. Les jobs Army de la même PR
ou du même push les lui délèguent (`ARMY_DATABASE_CHECKS_DELEGATED_TO`, lu par
[`database-checks.ts`](../../scripts/tester-army/database-checks.ts)) : leur
pile vérifie encore ses migrations et ses types générés, puis lance les
parcours. Le manifeste l'indique (`database.checks` : `delegated`, absent
quand le job exécute ses propres contrôles) et `army-critical` ou `army-full`
vert ne dit donc plus que le SQL est vérifié : c'est `rls-matrix` qui le dit,
et un `rls-matrix` rouge sur `main` ouvre son
[ticket d'alerte](#alerte-des-campagnes-de-main). Ailleurs (campagne
planifiée ou manuelle, push sur une autre branche, run local), rien n'est
délégué : la délégation y est refusée, faute de check qui réponde pour la
révision, et chaque job exécute ses propres contrôles.

Le compte/tenant ARMY et les secrets sont temporaires. Les sorties partageables
sont expurgées ; les journaux SQL privés et l'environnement natif ne sont pas
à publier. Avant tout envoi, le lanceur refuse une preuve qui contient un
secret de la pile, un JWT ou un jeton `Bearer`. Le mot de passe de la base
locale, `postgres` (valeur par défaut de la CLI Supabase), en fait partie ; or
les manifestes du run et du build listent chaque chemin source du build. Aucun
chemin sous `src/`, `scripts/` ou les autres racines du build ne doit donc
contenir `postgres`, ce que vérifie `army-evidence-source-paths.test.ts`. Le
24/11/2026, `src/test/native-postgres-tools.ts` a fait échouer ce contrôle sur
tous les jobs calc-v3 et Critical de la PR #530, après des parcours verts. Le runner détruit sa pile en sortie, y compris après échec normal.
La [reprise locale](tester-army-local-development.md#arrêt-et-reprise) traite
les interruptions brutales et ressources orphelines.

Pour diagnostiquer un échec, lire d'abord le manifeste de campagne, la phase
échouée, son rapport exact et son journal ; l'erreur finale du lanceur en cite
déjà la cause ([port applicatif et cause d'un
échec](tester-army-local-development.md#port-applicatif-et-cause-dun-échec)).
Une installation/build interrompu n'est pas un résultat métier. Conserver le premier échec avant correction ; ne
pas le masquer par un retry ou un timeout augmenté : la seconde tentative de la CI
[classe un échec, elle ne le rend jamais vert](#tentative-unique-et-quarantaine). Les workflows fixent les
artefacts, délais et durées de rétention actuels.

Les rôles de l'API annulent une requête après 8 s (`57014`), ce que
l'application répond par un 400 : le parcours échoue alors sur un code HTTP,
sans dire quelle requête a attendu. Pendant les parcours,
[`blocked-statements.ts`](../../scripts/tester-army/blocked-statements.ts)
relève deux fois par seconde les requêtes actives depuis plus d'une seconde et
les sessions qui les bloquent. `blocked-statements.jsonl`, à la racine des
preuves, garde une ligne par requête : sa durée la plus longue, l'attente
(`wait`, `waitingFor`) et, dans `blockedBy`, chaque session bloquante avec son
état et l'âge de sa transaction. `client` distingue l'API (`api`), le SQL direct
des fixtures (`sql`) et les services Supabase (`service`). Une requête n'y figure que par son premier
mot-clé et les objets qualifiés qu'elle nomme (`with
public.atomic_create_estimate_item`) : aucun texte SQL ni valeur n'est publié.
Le fichier est absent quand rien n'a dépassé une seconde. Le manifeste indique
`blockedStatements.rounds`, le nombre de relevés revenus, et `status` :
`watched` en exige au moins un, `stopped-early` signale un `psql` parti avant
la fin, `unavailable` un relevé qui n'a rien pu lire. Un fichier absent avec
`unavailable` ne prouve donc pas qu'aucune requête n'a attendu. Ce relevé ne
fait jamais échouer un run.

Les fichiers `shared-supabase-*.md` restants sont des reçus historiques lus par
le garde de restamp ; leur présence protège les noms des migrations déjà
appliquées. Les autres documents de recettes encore présents sont référencés
par des scripts ou le registre de parcours hors sélection. Ce ne sont pas des
manuels de configuration actuels ni des preuves fraîches.
