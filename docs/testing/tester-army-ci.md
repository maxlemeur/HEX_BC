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
| [E2E RLS Matrix](../../.github/workflows/e2e-rls-matrix.yml) | Chaque PR vers `main`, push `main` qui touche `supabase/` ou la matrice, quotidien à 05:15 UTC et manuel ; toujours complet ; sur une PR il porte seul pgTAP et la matrice RLS, que les jobs Army lui délèguent |
| [Full](../../.github/workflows/e2e-army-full.yml) | Manuel, quotidien à 03:15 UTC et [après un push `main`](#campagnes-de-main-après-un-push) ; parcours de production et phase développement |
| [Calc-v3](../../.github/workflows/e2e-army-calc-v3.yml) | Manuel, quotidien à 04:45 UTC, PR vers `main` (phases atteintes) et [après un push `main`](#campagnes-de-main-après-un-push) ; phases du [guide calc-v3](tester-army-calc-v3.md), réparties en [groupes](#jobs-parallèles), check `army-calc-v3` |
| [CI night alert](../../.github/workflows/ci-night-alert.yml) | Après chaque campagne Full ou Calc-v3 de `main` (planifiée ou après un push), et manuel ; [ticket d'alerte](#alerte-des-campagnes-de-main) ouvert, commenté ou fermé |

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
alternative de filtre sans correspondance et un fichier local oublié des
collecteurs ou du registre d'exclusions. Chaque fichier demandé doit ensuite
être réellement exécuté et réussi.

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
remplacera par sa mesure. Une campagne rouge ouvre le
[ticket d'alerte](#alerte-des-campagnes-de-main).

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
planifiée ou lancée après un push, et tient un ticket GitHub par workflow, titré
« CI rouge sur main : <workflow> » :

- campagne rouge : le ticket est ouvert, ou reçoit un commentaire s'il l'est
  déjà. Il cite le run, ses jobs en échec et les parcours non passés que nomme
  `notPassed` dans le manifeste agrégé (rapports des shards et des phases
  calc-v3 de chaque groupe) ; un échec antérieur aux parcours n'en nomme aucun ;
- première campagne verte : le ticket est commenté puis fermé ;
- campagne annulée ou sans conclusion : rien n'est écrit ;
- résultat dépassé : une campagne planifiée et une campagne lancée après un push
  se chevauchent. Quand une autre campagne du même workflow a déjà rendu son
  verdict sur une révision plus récente de `main`, le résultat qui arrive après
  elle n'écrit rien : il ne ferme pas le ticket d'un rouge plus récent et ne
  rouvre pas celui qu'un vert plus récent a fermé.

Seuls les tickets ouverts par le workflow lui-même sont reconnus : le dépôt est
public et n'importe qui peut ouvrir un ticket du même titre. La variable de dépôt
facultative `CI_ALERT_ASSIGNEES` (identifiants séparés par des virgules) assigne
les nouveaux tickets ; sans elle, seuls les abonnés aux tickets du dépôt sont
notifiés. Une alerte qui échoue elle-même laisse un run « CI night alert » rouge.

Le déclenchement manuel rejoue l'alerte d'un run donné. Il n'écrit que si
l'option d'écriture est cochée et que ce run est une campagne de `main`
(planifiée ou après un push) ; sinon la décision est seulement affichée dans le
résumé du job.

## Jobs parallèles

[`army-shards.json`](../../scripts/tester-army/army-shards.json) fixe le nombre
de shards, leurs workers et les durées utilisées pour répartir les fichiers.
Chaque shard possède sa base, son compte et son build ; un fichier n'est pas
coupé entre plusieurs jobs. Les shards critical utilisent 2 workers ; full et
métré restent à 1. Une sélection trop petite ou impossible à répartir conserve
un seul job. Les durées ne choisissent pas la couverture.

`secondsPerShard` est la charge de parcours mesurée qu'un job porte avant
qu'un autre vaille sa pile et son build (environ trois minutes de runner par
job). Elle vaut ce qu'un shard porte quand la suite entière tourne (715 s en
critical, à 2 workers) : une sélection partielle remplit donc ses shards comme
la suite complète, au lieu d'en ouvrir un tous les 300 s. Les parcours du métré
(environ 320 s à 1 worker) tiennent dans un job, sous le budget de 400 s.

`neverTogether` liste les fichiers qui ne partagent jamais un shard, quelles que
soient leurs durées : les deux fichiers des
[parcours ChatGPT local](chatgpt-local.md#vérification) démarrent chacun un
serveur de développement, et les deux workers d'un shard compileraient les deux
serveurs à froid en même temps sur un seul runner. Une sélection qui contient
les deux fichiers compte donc au moins deux shards. Le lanceur applique la même
règle à une exécution filtrée (`--files`, `--grep`) : avec plus d'un worker, il
la refuse avant de créer la pile. Sans durées utilisables, le plan n'a qu'un
shard et la règle ne s'applique pas ; l'exécution de la suite entière dans un
seul job, repli d'une sélection impossible, ne les sépare pas non plus.

Les phases calc-v3 sélectionnées tournent en groupes : autant de jobs que leurs
secondes de parcours mesurées en remplissent à `calcV3.secondsPerGroup`
(480 s), jamais plus que de phases ni que `calcV3.maxGroups` (cinq). Trois
phases courtes partagent ainsi un job. Chaque job `army-calc-v3 group N/T` prépare une seule pile et un
seul build, puis exécute ses phases l'une après l'autre
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
réussi qu'à sa seconde tentative (son statut `flaky`). Quatre contrôles le
gardent rouge, chacun de son côté : `run-tester-army.mjs`, la validation de
`run-tester-army-ci.ts`, celle de chaque phase calc-v3 et l'agrégation. La
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
- [`army-retry-quarantine.test.ts`](../../src/test/army-retry-quarantine.test.ts)
  refuse dans `verify:pr` tout `test.fail` de `e2e/` sans ticket dans une raison
  littérale. Une campagne qui exécute un parcours attendu en échec sans ticket
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
job ; la matrice RLS l'exécute seule, sur chaque PR et chaque nuit sur
`main`. Voir les [budgets SQL](large-estimate-statement-budget.md).

pgTAP et la matrice RLS prouvent la base migrée, pas les parcours : le même
résultat dans chacune des piles d'une PR. Sur une pull request, ils tournent
donc une seule fois, dans le check requis `rls-matrix`, seuls sur leur pile et
plafonds compris. Ce check tourne en entier sur toute PR, de documentation
aussi : le label `army-full` ou un diff vide lancent des jobs Army sur une
telle PR. Les jobs Army de la même PR les lui délèguent
(`ARMY_DATABASE_CHECKS_DELEGATED_TO`, lu par
[`database-checks.ts`](../../scripts/tester-army/database-checks.ts)) : leur
pile vérifie encore ses migrations et ses types générés, puis lance les
parcours. Le manifeste l'indique (`database.checks` : `delegated`, absent
quand le job exécute ses propres contrôles) et `army-critical` vert ne dit
donc plus que le SQL est vérifié :
c'est `rls-matrix` qui le dit. Hors pull request (push sur `main`, campagnes,
run local), rien n'est délégué : la délégation y est refusée, faute de check
qui réponde pour la révision.

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
