# Développer et tester avec Army sur une base locale jetable

Le développement interactif et les tests réutilisent le bootstrap natif de la
CI : migrations du checkout, contrôles SQL/RLS, nouveau compte et tenant ARMY,
puis destruction de la pile possédée. Aucun accès au Supabase partagé n'est
nécessaire. Les modes `critical` et `full` gardent leur sélection par défaut.

## Utilisation

Sous Windows, utiliser un checkout Linux dédié sous WSL, avec Node 24. Ne pas
copier les `.env` du checkout Windows ni des identifiants du backend partagé.
Les fichiers `.env` et variables Supabase/DB héritées sont refusés.

À la première installation, depuis ce checkout :

```sh
npm ci
npx @e2e-dev/web install chromium --with-deps
```

Le runtime Supabase natif télécharge ses services et réutilise son cache local.
Docker et une authentification CLI distante ne sont pas nécessaires.

```sh
# Développement interactif avec rechargement à chaud
npm run dev:army -- --app-port 3118

# Création et duplication, avec assertions exactes et setup de connexion
npm run e2e:army:local -- --grep 'creation persists final French|duplication preserves hierarchy' --app-port 3118

# Campagnes complètes de production et de développement
npm run e2e:army:ci -- full --app-port 3118
```

La session dev affiche l'URL et le chemin d'un fichier privé contenant la
connexion du compte neuf. Le répertoire est en `0700`, le fichier en `0600`,
hors du dépôt et des preuves. Ils disparaissent à l'arrêt. Les appels fournisseur
et workers restent bloqués par le garde réseau local existant.

Ctrl+C arrête le groupe de processus Next possédé, retire les identifiants et
détruit la base temporaire. Les données de cette session ne sont pas conservées.
Après une modification des migrations, relancer la commande pour recréer la
base ; les migrations ne sont pas appliquées à chaud.

Les preuves expurgées restent sous `.e2e/army/ci/` : commande, sources, migrations,
environnement, identités de fixtures, résultats, logs et empreintes. Le mode dev
enregistre les sources avant/après et produit `stopped`, avec `e2e: not-run`.
Une session interactive ne qualifie pas une campagne métier. Les sources
doivent rester figées pendant `critical` et `full`.

### Itérer sur les parcours concernés

Pendant le développement, n'exécuter que les parcours touchés par la
modification ; la suite complète (`npm run e2e:army:ci -- full`) est lancée une
seule fois, à la validation du lot, sur des sources figées :

```sh
npm run e2e:army:local -- --grep '<motif>' --app-port 3118
```

npm transmet tout ce qui suit `--` à `run-tester-army-ci.ts critical`. `--grep`
est réservé à `critical`, accepté une seule fois et attend sa valeur dans
l'argument suivant (pas de forme `--grep=`). Le motif est une expression
régulière JavaScript appliquée aux titres des tests : la placer entre
apostrophes, `|` sépare plusieurs titres. Une valeur absente ou une expression
invalide est refusée avant toute étape. SQL/RLS/build et le setup de connexion
restent exécutés à chaque run ; un motif qui ne retient aucun scénario métier
authentifié reste un échec. Pour rejouer plusieurs fois les mêmes parcours sans
recréer la pile ni reconstruire l'application, utiliser la
[boucle d'itération](#boucle-ditération-réutilisable-e2earmydev-loop) ; elle ne
remplace pas ce run qualifiant.

`--files` remplace `--grep` par une liste de fichiers de parcours, séparés par
des virgules, sous `e2e/army/critical/` ou `e2e/army/local/` : c'est l'option
qu'utilise la sélection par impact de la CI. Les deux options s'excluent. Chaque
fichier doit exister ; le run échoue si un fichier demandé n'a pas tous ses
tests exécutés et réussis, ou si un autre fichier que ceux-là et le setup de
connexion s'exécute. Pour obtenir la liste qu'une pull request lancerait :

```sh
node scripts/tester-army/select-journeys.ts --event pull_request --base origin/main --head HEAD
npm run e2e:army:local -- --files '<liste « files » du rapport>' --app-port 3118
```

Le diff porte sur les commits (`base...head`), pas sur les modifications non
commitées. Le manifeste enregistre alors `scope: filtered-critical` et la liste
`journeyFiles`.
Règles de sélection : [TesterArmy CI](tester-army-ci.md#sélection-par-impact-des-parcours-critical).

`E2E_ARMY_WORKERS` (entier de 1 à 4, **1 par défaut**) fixe `workers` dans
`e2e.config.ts` ; toute autre valeur arrête le run avec une erreur explicite.
`run-tester-army-ci.ts` la refuse avant la création de la pile, la transmet aux
parcours et l'enregistre (`workers`) dans le manifeste. Les parcours partagent
un compte, son tenant et ses fixtures ARMY : `e2e.config.ts` refuse une valeur
supérieure à 1 hors des parcours `critical` de la pile éphémère possédée, la
seule pour laquelle `run-tester-army-ci.ts` définit `E2E_ARMY_LOCAL_DB_URL`.
Elle est donc refusée contre un Supabase partagé et pour les suites
performance, couverture et agent. En CI, `e2e-army-critical.yml` la fixe à
`2` dans l'environnement de la seule étape des parcours, jamais dans les
étapes d'installation (`src/test/ci-guardrails.test.ts` y refuse tout bloc
`env`) ; `e2e-army-full.yml` ne la définit pas et reste à 1.

Campagne du 16/10/2026 (WSL, suite critique complète, `e2e:army:local`) :
workers=1 vert 64/64 en 634 s ; workers=3 rouge 2 fois sur 2 (63/64, 408 s et
428 s), création de devis refusée en 400 par
`40001 ESTIMATE_CREATE_CONTEXT_CHANGED` sous écriture concurrente du même
tenant. Deux défauts applicatifs ont ensuite été corrigés, chacun avec sa
régression rouge puis verte :

- la course de création : `createEstimate` réécrivait les rôles MO par défaut
  sous le verrou de calcul du tenant et le 40001 sortait en 400 sans nouvel
  essai. Voir [création de devis sous le verrou de calcul](estimate-create-calculation-gate.md) ;
- le double rendu transitoire du hub d'affaire (HUB02, `LOCATOR_AMBIGUOUS`,
  2 suites sur 3 à workers=2) : `DashboardNavigationProvider` n'enveloppe plus
  que l'en-tête. Son changement de valeur juste après l'hydratation obligeait
  React à recréer côté client la page streamée encore masquée ; les deux copies
  coexistaient jusqu'à sa révélation. Parcours HUB11 dans `team-a-hub.e2e.ts`.

**workers=2 est requalifié** pour les parcours `critical` de la pile éphémère
possédée : avec les deux corrections, deux suites complètes vertes 68/68, sans
reprise (parcours 349 s et 348 s, contre 634 s à workers=1). Preuves :
`.codex-tmp/hub02-hydration-20261016/w2-full-1` et `w2-full-2` du checkout
principal ; le code fusionné est identique à celui exécuté, hors commentaires.
Le défaut reste 1. Depuis le 17/10/2026, la CI critical
(`e2e-army-critical.yml`, pull request et push sur main) tourne à 2 workers ;
la suite full nocturne (`e2e-army-full.yml`), dont les parcours étendus et
takeoff ne sont pas qualifiés à 2, reste à 1. 3 ou 4 workers restent
exploratoires : une seule suite complète verte est prouvée à workers=3, avant la
correction de HUB02.

### Boucle d'itération réutilisable (`e2e:army:dev-loop`)

Chaque `e2e:army:local` recrée une pile, rejoue migrations, pgTAP et matrice RLS,
provisionne un compte et reconstruit l'application avant le premier parcours.
Pour rejouer plusieurs fois les mêmes parcours pendant une mise au point, la
boucle, en opt-in, garde ces étapes ouvertes entre deux essais :

```sh
npm run e2e:army:dev-loop -- start --app-port 3118 [--ttl-minutes 60]
npm run e2e:army:dev-loop -- run --grep '<motif>'
npm run e2e:army:dev-loop -- run --files 'e2e/army/critical/a.e2e.ts,e2e/army/local/b.e2e.ts'
npm run e2e:army:dev-loop -- status
npm run e2e:army:dev-loop -- stop
```

`start` lance en arrière-plan un superviseur
`run-tester-army-ci.ts dev-loop`, puis rend la main quand il est prêt. Le
superviseur passe par la même préparation que `critical` : refus d'un `.env` ou
d'une cible Supabase héritée, pile native possédée et jetable, ports Supabase
alloués hors de la plage éphémère et des ports interdits au navigateur.
`--app-port` refuse en plus `45585` et `33485` (y compris écrits `045585`),
ports de la pile de recette locale des développeurs (API et base) : le client
`start` comme le superviseur lui-même (`e2e:army:ci -- dev-loop`) les refusent
avant toute étape. Le superviseur refuse aussi `--grep` et `--files` : chaque
`run` choisit sa sélection. Il exécute une seule fois migrations,
pgTAP et matrice RLS, crée le compte, le tenant et les fixtures ARMY, puis
construit l'application en production avec `build-local.mjs`. Pour chaque `run`, il exécute les parcours
critical sélectionnés sur cette pile et ce build, avec tous les contrôles de
`critical` : setup de connexion exact et parcours métier authentifié, ni skip,
ni succès après retry, ni interruption, `--files` exact, sources et build
inchangés pendant le run. `--grep` ou `--files` est obligatoire, avec les mêmes
règles que `e2e:army:local`. Seule la phase `critical` est disponible : full,
development et les phases calc-v3 gardent leurs commandes. Deux `run`
simultanés sont refusés (`busy`, code 2).

Reconstruction : avant chaque `run`, la boucle calcule l'empreinte des entrées
enregistrées par `build-local.mjs` (`buildSourceEvidence().inputs` : `src`,
`public`, `scripts`, `tools`, `next.config.ts`, `postcss.config.mjs`,
`package.json`, `package-lock.json`, `tsconfig.json`, `openapi.json`, fichiers
non suivis compris). L'empreinte porte sur le contenu, pas sur la révision ni
le diff. Elle reconstruit si cette empreinte diffère de celle du dernier build,
lue dans son propre manifeste, ou si `.e2e/army/next/BUILD_ID` a disparu ou
changé, par exemple après un autre build dans ce checkout. Une modification
limitée à `e2e/**` ne reconstruit pas. Une modification de
`supabase/migrations` ou de `supabase/config.toml` depuis le démarrage fait
échouer le `run` : arrêter puis redémarrer la boucle. Il en va de même pour les
modules du superviseur : `scripts/run-tester-army-ci.ts` et ses imports locaux,
transitivement, hors imports de type (`scripts/tester-army/dev-loop*.ts`,
`local-recipe-common.mjs`, `local-development.ts`, `src/test/local-supabase-ci.ts`,
etc.). Le superviseur les a chargés au démarrage et leurs contrôles sont ceux de
ce moment : leur empreinte est relevée dans l'état et chaque `run` la compare
avant tout build ou parcours. Durcir un garde Army se vérifie donc après un
redémarrage de la boucle. Ces deux contrôles (entrées de la pile et modules du
superviseur) sont refaits juste avant les parcours. Pendant le build,
`build-local.mjs` ne refuse que la modification d'un fichier suivi par Git
(migration ou `config.toml` existants) : il compare avant et après le diff du
dépôt (`git diff HEAD`, `sourceChangedDuringBuild`). Ses fichiers non suivis
se limitent aux portées de `buildSourceEvidence` (`src`, `scripts`, etc.), dont
`supabase/` ne fait pas partie. Une migration ajoutée pendant le build lui
échappe donc, comme toute modification faite avant son premier relevé ou après
le dernier : seul le second contrôle, juste avant les parcours, la refuse. Il
n'est pas redondant. L'itération reconstruit aussi quand le manifeste
du build courant (`.e2e/army/recipes/builds/<id>/manifest.json`) a disparu
ou ne correspond plus à son empreinte : sans lui, l'itération ne pourrait pas
prouver les entrées de son build.

Vérification de types : le build Army type-checke `.e2e/army/tsconfig.json`,
qui n'inclut que `src/**`, `next-env.d.ts` et les types générés par Next. Les
parcours `e2e/**` ne sont donc vérifiés par aucun run Army actuel, qualifiant
ou non ; `npm run typecheck` (dans `verify:pr`) les couvre. Ne pas reconstruire
pour une modification de parcours ne retire aucun contrôle, et la boucle ne
lance pas de `tsc` supplémentaire. `src/test/army-dev-loop.test.ts` échoue si ce
tsconfig inclut un jour une source hors de l'empreinte.

Serveur Next : le SDK démarre toujours `next start` sur le build existant à
chaque `run`, comme dans `critical`. `run-tester-army.mjs` exige un reçu du
garde réseau serveur propre à chaque run et le journal de l'application
possédée ; un serveur partagé entre les runs perdrait ces deux preuves. Mesuré
le 18/10 : `next start` annonce « Ready in » en 56 à 75 ms, et le run SDK
complet de HUB03 (démarrage, setup de connexion, parcours) dure 3,8 s.

État et secrets : `.e2e/army/dev-loop/state.json` (mode `0600`) contient
l'identité de la boucle, le pid du superviseur, le projet, le répertoire et les
huit ports de la pile, l'empreinte des entrées SQL et du build, l'identifiant de
build et les dates (démarrage, dernière activité, expiration). Son écriture
refuse toute clé ou valeur ressemblant à un secret : JWT, clé `sb_`, URL
PostgreSQL, adresse électronique, champ `password` ou `token`. Le compte,
les clés et l'URL PostgreSQL ne quittent pas la mémoire du superviseur : `run`
lui parle par une socket Unix dans un répertoire temporaire privé (`0700`,
socket `0600`). Un seul superviseur par checkout : l'état est créé en exclusif.

Arrêt, expiration et état abandonné :

- une boucle n'est tenue pour fermée que si trois conditions sont réunies :
  le répertoire de travail de sa pile a disparu, son entrée du registre natif
  (`~/.supabase/stacks/<id>/`, qui garde `data/` et `state.json` jusqu'au
  `stack destroy`) a disparu, et ses huit ports sont fermés. Une quatrième
  s'y ajoute si la boucle s'est arrêtée pendant les parcours d'une itération
  (`journeysStartedAt` dans l'état, voir plus bas) : son port applicatif doit
  être fermé sur `127.0.0.1` comme sur `::1`. Le superviseur comme `stop`
  appliquent cette preuve avant de retirer l'état ; sinon l'état passe en
  `cleanup-failed` avec la cause. `runLocalSupabaseCi` supprime le répertoire
  même quand `stack destroy` échoue : seule l'entrée du registre révèle alors
  la pile restante ;
- une entrée du registre dont `state.json` manque, est illisible (droits),
  n'est pas du JSON ou ne porte pas `identity.projectRoot` peut être la pile de
  la boucle : elle n'est jamais ignorée. Elle est relue une fois après une
  seconde (une autre session peut être en train de l'écrire), puis laisse la
  preuve non faite, avec son nom dans l'erreur. Une telle entrée laissée par
  une autre session bloque donc la libération de l'état tant qu'elle n'a pas
  été inspectée à la main ;
- le port applicatif n'appartient à la boucle que pendant les parcours d'une
  itération. Un `kill -9` du superviseur à ce moment laisse vivre ses
  enfants : le processus des parcours et son `next start` continuent sur ce
  port. Chaque itération écrit donc `journeysStartedAt` dans l'état juste
  avant ses parcours. Elle ne l'efface qu'une fois les parcours revenus et le
  port refermé sur les deux boucles locales ; s'il écoute encore, la marque
  reste et le manifeste d'itération porte `appPortAfterJourneys`. Avec la
  marque, `stop` détruit quand même la pile, mais garde l'état en
  `cleanup-failed` (« application port … still listening ») jusqu'à la
  fermeture du port ; un nouveau `stop` retire alors l'état. `stop` ne termine
  pas ces processus : le run natif du 18/10 a vu `next-server` rester orphelin
  plus de trois minutes, et il faut l'arrêter à la main (voir « Correctifs
  après la seconde revue »). Avec la marque, une origine dont le port est
  illisible ne prouve rien. Sans la marque (boucle au repos, jamais lancée ou
  tuée hors des parcours), le port n'est pas sondé, puisqu'un autre processus
  peut l'utiliser : `appPortClosed` vaut `null` dans le rapport de `stop` et
  dans `devLoopCleanup`. Le superviseur vérifie aussi le port applicatif avant
  de revendiquer le checkout : un `start` sur un port occupé échoue avec
  « Local application port … is unavailable », sans écrire d'état ;
- un état copié ou restauré dans un autre checkout (copie du dépôt, sauvegarde
  restaurée) nomme le superviseur, la socket et la pile de son checkout
  d'origine. `start`, `run` et `stop` refusent donc tout état dont le champ
  `checkout`, résolu (`realpath`), n'est pas le checkout courant, avant de
  lire son pid, sa socket ou ses métadonnées de nettoyage : rien n'est
  signalé, arrêté ni supprimé, et le message renvoie vers le checkout
  d'origine. `status` le classe `foreign-checkout` sans sonder le pid. Le
  fichier copié se retire à la main, une fois vérifié que c'est une copie ;
- un checkout déplacé ou renommé (`mv`) emporte son `.e2e/` : son état
  enregistre un `checkout` qui n'existe plus (cas « recorded checkout no
  longer exists » du message). Ce n'est pas une copie, et sa pile native peut
  exister encore. `start`, `run` et `stop` le refusent aussi, avec « records
  checkout …, which no longer exists (moved or renamed?) », sans rien signaler
  ni supprimer. Avant de retirer cet état, reprendre la pile à la main, comme
  la reprise du 16/10, depuis le checkout où se trouve l'état :
  1. vérifier qu'aucun superviseur de cette boucle ne tourne plus
     (`ps -o args= -p <supervisor.pid>` et `readlink /proc/<pid>/cwd`). S'il
     tourne encore, son répertoire courant a suivi le déplacement, mais ses
     écritures d'état visent l'ancien chemin : lui envoyer `SIGTERM`, attendre
     sa fin, puis vérifier les points 2 et 3 quoi qu'il annonce (ce cas n'a
     pas été exécuté) ;
  2. chercher l'entrée du registre dont `identity.projectRoot` est
     `stack.rootDirectory`, parmi `~/.supabase/stacks/*/state.json`, et
     vérifier que son port `api` fait partie de `stack.ports`. La CLI enregistre
     le chemin réel : sous macOS, `/private/var/folders/…` pour un
     `stack.rootDirectory` en `/var/folders/…` (`/var` est un lien vers
     `/private/var`). Comparer donc après résolution des liens, celle du parent
     si le répertoire a disparu ;
  3. si `stack.rootDirectory` existe et que son `supabase/config.toml` porte
     `project_id = "<stack.projectId>"`, ou si l'entrée du registre existe,
     recréer au besoin ce répertoire avec un `supabase/config.toml` qui ne
     contient que `project_id = "<stack.projectId>"`, `[experimental]` et
     `stack = true`. Lancer ensuite `npx supabase stop --workdir <répertoire>`
     puis `npx supabase stack destroy --yes --workdir <répertoire>`, et
     supprimer ce répertoire ;
  4. une fois l'entrée du registre disparue et `stack.ports` fermés, retirer
     le répertoire de la socket s'il reste, puis `state.json` ;
- `stop` vérifie que le pid enregistré est bien ce superviseur (ligne de
  commande et répertoire courant, pas un pid recyclé), lui envoie `SIGTERM` et
  attend sa fin. Le superviseur interrompt le run en cours, sort de
  `runLocalSupabaseCi`, qui exécute `stop` puis `stack destroy` et supprime le
  répertoire du projet, puis il retire son état. `stop` refait ensuite la
  preuve ci-dessus et vérifie l'état retiré, sinon il échoue ;
- sans `run` pendant le TTL (60 min par défaut, de 5 à 720), le superviseur
  s'arrête seul, avec le même nettoyage. Le TTL est réarmé avant toute écriture
  de l'état : un échec d'écriture (disque plein, droits) ne bloque ni
  l'expiration ni `stop`, et chaque `run` reçoit un seul résultat ;
- si le superviseur est mort (`kill -9`) ou si son pid a été recyclé, `start`
  et `run` refusent l'état abandonné. `stop` détruit alors lui-même la pile
  enregistrée (`stop`, `stack destroy`, suppression du répertoire temporaire
  possédé), seulement si son `config.toml` porte le `project_id` enregistré,
  qui nomme ce superviseur ;
- si le répertoire de travail a aussi disparu (un redémarrage WSL vide `/tmp`),
  `stop` retrouve la pile dans le registre natif : `identity.projectRoot` est
  égal au répertoire enregistré, liens résolus des deux côtés (par le parent
  pour un répertoire disparu ; macOS `/var` -> `/private/var`), et le port `api`
  déclaré fait partie des ports enregistrés. Seules ces deux valeurs sont lues, jamais les `credentials` de
  l'entrée. La CLI 2.120 refuse un `--workdir` absent : `stop` recrée donc le
  répertoire temporaire possédé, vide hormis un `supabase/config.toml` qui porte
  le `project_id` enregistré et `[experimental] stack = true`, comme la reprise
  manuelle du 16/10. Il exécute ensuite `stop` et `stack destroy`, puis
  supprime ce répertoire. Une entrée dont le port `api` n'a pas été alloué par
  la boucle est refusée. Dans tous les cas, `stop` retire la socket et refait
  la preuve de destruction avant de supprimer l'état.

Preuves : la session écrit `.e2e/army/ci/<horodatage>-dev-loop/manifest.json`
(`scope: "dev-loop session (reused stack, not a qualification run)"`,
`qualification: false`, SQL/RLS, provisionnement, builds, liste des itérations,
nettoyage). Chaque `run` écrit `iterations/<NNN>-<horodatage>/manifest.json`
dans ce dossier, avec `scope: "iteration (reused stack, not a qualification run)"`
et `qualification: false`. Ce manifeste contient la commande, la révision, le
diff et l'empreinte applicative, la décision de build et sa raison, les
identités de fixtures, la provenance de la base, les durées, les phases et le
rapport, ainsi que l'inventaire des fichiers après contrôle de
confidentialité. Un superviseur tué n'écrit pas le manifeste final de sa
session : chaque itération, reconstruite ou non, porte donc elle-même le
build sur lequel elle tourne (`build.buildManifest`, `build.buildManifestSha256`)
et en garde une copie vérifiée, avec son journal, sous
`builds/<id>/` de son dossier ; l'état porte aussi ce chemin et cette
empreinte depuis le build. Le run SDK d'une itération archive aussi, comme tout run critical, sa
copie brute sous `.e2e/army/critical/runs/<horodatage>/`, à côté des archives
qualifiantes. La boucle y dépose `dev-loop-iteration.json` (`scope` de
l'itération, `qualification: false`, boucle, numéro et manifeste de
l'itération) et en enregistre le chemin dans `sdkArchiveMarker` du manifeste
d'itération : une archive qui porte ce fichier n'est jamais une preuve.

Limites : les itérations partagent le compte et le tenant, et les données
s'accumulent (chaque parcours garde son préfixe `ARMY-…` unique). Un parcours
qui suppose un tenant vierge demande donc un run neuf. pgTAP et la matrice RLS ne
tournent qu'au démarrage ; une modification de `supabase/tests` n'est pas
rejouée. Tant qu'un état de boucle existe dans le checkout, même abandonné,
`e2e:army:local`, `e2e:army:ci` et `e2e:army:calc-v3` refusent de démarrer :
ils partagent `.e2e/army/next` et `.e2e/army/critical` avec elle. Il faut
arrêter la boucle d'abord. Les commandes SDK directes (`e2e:army:critical`,
`e2e:army:full`, etc.) et un run qualifiant déjà en cours au moment du `start`
ne sont pas détectés : ne pas les mêler à une boucle ouverte.
Windows n'est pas pris en charge (WSL, comme le runtime natif). La boucle
occupe une pile native tant qu'elle est ouverte et compte donc dans la limite
de piles simultanées : l'arrêter dès la fin de la mise au point.

Un run qualifiant neuf reste exigé pour toute preuve de lot ou de pull request
(`e2e:army:local` sur la sélection, `e2e:army:ci -- full` à la validation du
lot), après une modification de migration ou de `config.toml`, et chaque fois
qu'un parcours dépend d'une base vierge. Une itération ne remplace jamais une
qualification, même verte, et ne réutilise pas la preuve d'entrées différentes.

#### Contrat défini avant implémentation

Les échecs suivants ont été écrits avant le code, dans l'en-tête de
`src/test/army-dev-loop.test.ts`, puis épinglés par ses tests. Leur RED précède
l'implémentation. Une isolation est justifiée : aucun parcours ne voit la
comptabilité de la boucle, et un parcours passe aussi bien sur un build périmé
ou à côté d'une pile orpheline.

1. Deux superviseurs revendiquent le même checkout et partagent son build.
2. Un superviseur mort ou un pid recyclé passe pour une boucle vivante, ou une
   boucle vivante pour un état abandonné.
3. Une clé, une URL PostgreSQL ou l'adresse du compte atteint l'état.
4. Une modification limitée aux parcours reconstruit, ou une modification
   applicative, une source supprimée ou un build remplacé ne reconstruit pas.
5. Le build type-checke un fichier hors de l'empreinte.
6. Migrations ou `config.toml` changent sous une boucle qui continue.
7. `stop` supprime un répertoire ou détruit une pile qui ne lui appartient pas
   (état corrompu ou étranger), ou annonce une pile détruite alors qu'un de
   ses ports écoute encore. Le refus d'une pile étrangère a été ajouté après le
   premier cycle WSL, avec son propre RED.
8. La ligne de commande accepte une sélection ambiguë ou absente, un motif
   invalide, une option répétée, un TTL hors bornes ou un port interdit.

La revue indépendante du 18/10 a ajouté cinq échecs, écrits dans le même
en-tête avec leur RED avant le correctif :

9. Le répertoire de travail d'un superviseur mort a disparu alors que son
   entrée du registre natif et ses données restent : `stop` annonce la pile
   détruite et efface le seul lien vers elle, ou le superviseur retire son état
   malgré l'échec de `stack destroy`.
10. Un échec d'écriture de l'état pendant un `run` laisse le superviseur
    occupé pour toujours, désarme le TTL ou remplace le résultat de
    l'itération.
11. L'archive SDK brute d'une itération passe pour un run critical qualifiant,
    ou un run qualifiant démarre dans un checkout dont la boucle partage la
    sortie `.e2e/army`.
12. Le superviseur lancé par `e2e:army:ci -- dev-loop` accepte un port de la
    pile partagée, ou un filtre de parcours (`--grep`, `--files`) qu'il ignore
    ensuite, que seul le client `start` refusait.
13. Les modules du superviseur changent sous une boucle ouverte : l'itération
    enregistre alors le checkout courant, mais applique les contrôles chargés
    au démarrage.

La seconde revue du 18/10 (Codex, PR #43) en a ajouté cinq, avec le même
ordre :

14. Un état copié ou restauré dans un autre checkout pendant que sa boucle
    tourne passe pour celui du checkout courant : `stop` envoie `SIGTERM` au
    superviseur de l'autre checkout, `run` pilote sa socket, le nettoyage
    retire sa socket ou sa pile.
15. Une migration ou `config.toml` modifiés après le premier contrôle d'une
    itération atteignent les parcours, qui tournent alors sur le schéma du
    démarrage. Pendant le build, `build-local.mjs` ne refuse que la
    modification d'un fichier suivi, par le diff du dépôt : une migration
    ajoutée, comme toute modification faite hors de ses relevés, n'est
    refusée que par le contrôle refait avant les parcours.
16. Après un `kill -9` pendant une itération, le processus des parcours et son
    `next start` survivent sur le port applicatif, tandis que `stop` annonce
    la boucle fermée et retire son état.
17. Les preuves d'une itération sans reconstruction nomment un build dont seul
    le résumé de session, en mémoire, gardait le manifeste et les entrées :
    ils disparaissent avec un superviseur tué.
18. Une entrée du registre illisible, malformée ou sans droit de lecture est
    ignorée : la preuve annonce le registre vide et supprime le seul état de
    reprise.

La revue de suivi du 18/10 (relecture indépendante des correctifs 14 à 18) en
a ajouté deux :

19. La preuve exige le port applicatif fermé alors que la boucle n'y possède
    aucun processus. Un `start` sur un port qu'un autre processus occupe, ou
    une boucle au repos à côté d'un serveur sans rapport, laisse alors un état
    `cleanup-failed`. Cet état bloque `e2e:army:local`, `e2e:army:ci` et
    `e2e:army:calc-v3` dans le checkout et masque la vraie cause. Une boucle
    tuée pendant ses parcours doit pourtant garder son état jusqu'à la
    fermeture du port.
20. Un état dont le checkout enregistré n'existe plus (déplacé ou renommé)
    est présenté comme une copie : le message pousse à supprimer le seul lien
    vers une pile native au lieu de la reprendre.

`src/test/local-supabase-ci.test.ts` vérifie en plus le nouveau rappel
`onProjectPrepared` : identité et ports du projet isolé transmis avant le
démarrage de la pile, puis nettoyage si l'enregistrement échoue.

#### Validation exécutée (18/10/2026)

Les preuves viennent du clone Linux `~/miaouffrage-e2e-loop` (WSL Ubuntu 24.04,
24 cœurs, 31 Go, Node 24.19, Army 0.21), sur le port applicatif 3187, sans
modification locale hors des éditions de preuve citées. Le cycle principal, les
refus, le TTL et le premier abandon tournent sur `f3db5d7a`. La reprise de
l'abandon et le run de comparaison tournent sur `7702d800`, qui ne change que
le nettoyage d'un état abandonné (garde du `project_id`). Sélection :
`--grep HUB03`, soit le setup de connexion et HUB03 (`hub-plans-card.e2e.ts`)
sur chromium-desktop.

| Étape | Durée murale | Résultat |
| --- | --- | --- |
| `start` : pile, `db reset`, pgTAP, RLS, compte, build à froid de 80,7 s | 107,5 s | prêt |
| 1er `run --grep HUB03` | 7,0 s | 2/2, sans build |
| 2e `run --grep HUB03` | 5,3 s | 2/2, sans build |
| parcours seul modifié (commentaire dans `hub-plans-card.e2e.ts`) | 5,4 s | 2/2, sans build |
| source modifiée (commentaire dans `src/lib/money.ts`) | 63,9 s | build 57,4 s, puis 2/2 en 6,0 s |
| après ce build, `run --files e2e/army/critical/hub-plans-card.e2e.ts` | 15,7 s | 4/4, sans build : l'empreinte relue dans le manifeste du build est juste |
| `stop` | 2,2 s | répertoire supprimé, 8 ports et port applicatif fermés, état et socket retirés |
| comparaison : `e2e:army:local -- --grep HUB03 --app-port 3187` | 69,5 s | 2/2 : pile, SQL, RLS et compte 24 s, build 37,8 s, cache webpack déjà chaud, parcours 6,5 s |

Sur cet hôte, une itération coûte donc 5 à 7 s, contre 69,5 s pour le run
qualifiant de la même sélection avec un cache webpack chaud, et environ 107 s à
froid, comme le `start`. L'écart croît avec la durée de build de l'hôte. Les
deux manifestes de session terminés et les huit itérations enregistrent
`qualification: false` et `privacy: passed`.

Chemins de sécurité exécutés :

- deux `run` simultanés : le second reçoit `busy` (code 2), le premier passe ;
- une ligne ajoutée à la dernière migration du clone fait échouer le `run`
  avant tout build ou parcours : « Migrations or supabase/config.toml changed
  since the loop started ». Le fichier a ensuite été restauré ;
- `kill -9` du superviseur après `start` : six ports de la pile restent
  ouverts. `run` et `start` refusent l'état abandonné ; `stop` détruit la pile
  en 1,6 s, puis en 1,9 s sur `7702d800`. Répertoire, socket et état sont
  retirés et plus aucun port n'est ouvert ;
- TTL de 5 min sans `run` : arrêt seul à l'échéance (`stopReason: ttl-expired`),
  état retiré, répertoire supprimé, plus aucun port ouvert, manifeste `stopped` ;
- l'état est en `0600`, le répertoire de la socket en `0700` et la socket en
  `0600`. Ni l'état ni les preuves copiées ne contiennent de JWT, de clé `sb_`,
  d'URL PostgreSQL avec mot de passe ni d'adresse de compte ;
- sous Windows, `e2e:army:dev-loop` refuse avant toute étape et renvoie vers WSL.

Tests d'isolation : `src/test/army-dev-loop.test.ts` échoue d'abord contre un
module bouchon : sous Windows, 5 échecs et 1 test sauté ; sous WSL, 6 échecs.
Le test de garde du type-check passe dès le RED, car il épingle un invariant
déjà vrai. Le test de propriété du `project_id` est RED
(`ownsRecordedProject is not a function`) avant sa garde. Résultat final sur
`7702d800` avec `ci-guardrails`, `local-supabase-ci` et `army-impact-map` :
Windows 55 réussis, 1 sauté (le test du superviseur lit `/proc` ou `ps`) ; WSL
56/56. Typecheck et ESLint ciblé passent. Journaux RED/GREEN, journaux WSL,
manifestes de session et d'itération, `timings.txt` et `SHA256SUMS` :
`.codex-tmp/e2e-dev-loop-20261018/` du worktree `miaouffrage-e2e-loop`.

#### Correctifs après revue (18/10/2026)

Tests d'isolation écrits d'abord contre des exports bouchons qui gardent le
comportement antérieur : RED sous Windows, 5 échecs, 6 réussis, 4 sautés (les
tests de session ouvrent une socket Unix) ; RED sous WSL, 8 échecs, 7 réussis.
Chacun échoue pour sa raison : registre ignoré, aucun marqueur, aucune
empreinte de modules, refus absents, superviseur bloqué après un échec
d'écriture, double résultat, itération passée malgré un module modifié. Puis
GREEN : Windows 11 réussis et 4 sautés, WSL 15/15. Le cas « répertoire
recréé pour la CLI » a été ajouté après le run natif ci-dessous, avec son
propre RED (`destroy failed`) avant le correctif. Les tests de lancement du
superviseur s'exécutent dans un checkout temporaire contenant un `.env` :
si un refus régressait, le run s'arrêterait encore au contrôle `.env`, avant
tout port, état ou pile.

Runs natifs dans le clone WSL, port applicatif 3187, sélection `--grep HUB03`.
Le cycle principal tourne sur `d21e50f9` ; la reprise après échec, le
redémarrage simulé et le `kill -9` tournent sur `4e5e4927`.

| Étape | Durée murale | Résultat |
| --- | --- | --- |
| `start` (cache webpack chaud) | 68,3 s | prêt |
| `run --grep HUB03` | 5,4 s | 2/2, sans build ; `dev-loop-iteration.json` déposé dans `.e2e/army/critical/runs/2026-10-18T01-57-30-189Z/` |
| `e2e:army:local -- --grep HUB03 --app-port 3188`, boucle ouverte | < 1 s | code 1 : « A dev loop is open in this checkout », aucune pile démarrée |
| `e2e:army:ci -- dev-loop --app-port 45585` | < 1 s | code 1 dès la lecture des options, avant toute preuve ou tout état |
| commentaire ajouté à `scripts/tester-army/dev-loop-state.ts` | < 1 s | itération 2 en échec avant build et parcours : modules du superviseur modifiés |
| fichier restauré, `run --grep HUB03` | 5,2 s | 2/2, sans build |
| `stop` | 2,2 s | répertoire, entrée du registre, ports et état retirés |
| redémarrage simulé (`kill -9`, `supabase stop --workdir`, suppression du répertoire), `stop` sur `d21e50f9` | 0,7 s | code 1 : la CLI refuse le `--workdir` absent, l'état reste en `cleanup-failed`, l'entrée et ses données restent |
| même état, `stop` sur `4e5e4927` | 1,1 s | code 0 : répertoire recréé, pile détruite, entrée du registre retirée, état retiré |
| redémarrage simulé de bout en bout sur `4e5e4927` | 69,3 s + 1,1 s | `start`, puis un seul `stop` : code 0, plus d'entrée, aucun port ouvert |
| `kill -9` avec répertoire présent sur `4e5e4927` | 66,3 s + 1,8 s | 6 ports ouverts avant ; `stop` code 0, tout est retiré |

Les quatre manifestes de session et leurs itérations enregistrent
`qualification: false` et `privacy: passed` ; `devLoopCleanup` porte
`registryEntryRemoved: true`. Journaux, états, manifestes, scripts et
`SHA256SUMS` : `.codex-tmp/e2e-dev-loop-20261018/ship-prep/` du worktree
`miaouffrage-e2e-loop`.

Non exécutés : macOS ; un vrai redémarrage WSL, simulé par l'arrêt des
services et la suppression du répertoire ; un `stop` pendant le démarrage,
testé seulement après « ready » ; un échec réel d'écriture de l'état dans le
superviseur, couvert seulement par test d'isolation.

#### Correctifs après la seconde revue (18/10/2026)

Les cinq constats de Codex ont été vérifiés dans le code avant correction.
Échecs 14 à 18 de `src/test/army-dev-loop.test.ts`, écrits d'abord contre des
exports bouchons gardant le comportement antérieur : RED sous Windows, 4
échecs, 10 réussis, 7 sautés (socket Unix, `/proc`) ; RED sous WSL, 7 échecs,
14 réussis. Chacun échoue pour sa raison : `run` de la copie atteint la socket
de l'original, `stop` de la copie envoie `SIGTERM` à son superviseur et retire
l'état ; parcours lancés malgré une migration arrivée en fin de build ; état
retiré malgré le port applicatif ouvert ; entrée tronquée ignorée ; aucune
référence au build dans une itération sans reconstruction. Puis GREEN :
Windows 14 réussis et 7 sautés, WSL 21/21. Avec `ci-guardrails` et
`local-supabase-ci` : Windows 52 réussis et 7 sautés, WSL 59/59. Typecheck et
ESLint ciblé passent.

Runs natifs dans le clone WSL sur `8b8462f4`, port applicatif 3187, sélection
`--grep HUB03` :

| Étape | Durée murale | Résultat |
| --- | --- | --- |
| `start` | 67,3 s | prêt ; `state.build` porte le chemin et l'empreinte du manifeste du build |
| `run`, sans build | 5,9 s | 2/2 ; l'itération nomme et garde une copie vérifiée du manifeste de son build (1771 entrées), inventoriée |
| état copié dans un autre checkout (`git worktree` du clone, même révision) : `status`, `run`, `start`, `stop` depuis la copie | < 0,3 s chacun | `status` : `foreign-checkout` ; les trois autres, code 1, « Nothing was signalled, stopped or removed » ; superviseur vivant, socket et ports intacts, deux états inchangés |
| `run` depuis le clone, ensuite | 5,4 s | 2/2, la boucle est intacte |
| source modifiée, migration suivie modifiée 8 s après le début du build | 42,2 s | refus par `build-local.mjs` (`sourceChangedDuringBuild`, par le diff du dépôt), garde déjà présent ; aucun parcours |
| sources restaurées, `run` | 45,8 s | build (le précédent avait remplacé `BUILD_ID`), puis 2/2 |
| `stop` | 2,2 s | pile, registre, 8 ports et port applicatif fermés (IPv4, IPv6), état retiré |
| 2e boucle : source modifiée, migration modifiée juste après la décision de build, avant le relevé de `build-local.mjs` | 40,8 s | build réussi (`sourceChangedDuringBuild: false`), puis échec « Migrations or supabase/config.toml changed » avant tout parcours |
| `kill -9` du superviseur pendant les parcours d'une itération | — | survivent : le processus SDK `e2e`, `next-server` sur 3187 et les hôtes Supabase ; le dossier de l'itération tuée garde déjà le manifeste et le journal de son build |
| `stop` juste après | 11,9 s | code 1 : pile détruite (répertoire, registre, ports), `appPortClosed: false`, état en `cleanup-failed` |
| attente de 180 s | — | le processus SDK a fini, `next-server` (orphelin) écoute toujours sur 3187 ; arrêté à la main (`SIGTERM`, identifié par son répertoire courant dans le clone) |
| `stop` ensuite | 0,2 s | code 0, état retiré |

Le manifeste de la première session porte `appPortClosed: true` ; celui de la
seconde n'existe pas (superviseur tué), mais chacune de ses itérations porte
son build. Toutes enregistrent `qualification: false` et `privacy: passed`.
Journaux, états, manifestes, scripts et `SHA256SUMS` :
`.codex-tmp/e2e-dev-loop-20261018/review-f1-f5/` du worktree
`miaouffrage-e2e-loop`.

Constat du run natif : après un `kill -9`, `next-server` reste orphelin au
moins trois minutes. `stop` ne le termine pas (il ne connaît pas son pid) ; il
le signale et garde l'état. L'identifier (`ss -ltnp 'sport = :<port>'`),
vérifier que son répertoire courant est ce checkout, l'arrêter, puis relancer
`stop`.

Non exécutés : une entrée du registre natif illisible, couverte seulement par
test d'isolation sur un registre jetable (le registre réel est partagé avec
les autres sessions) ; macOS.

#### Correctifs après la revue de suivi (18/10/2026)

Les trois constats de la revue de suivi ont été vérifiés dans le code avant
correction, et le premier a été reproduit par son test :

- échec 19 (majeur) : le superviseur revendiquait le checkout avant de
  vérifier le port applicatif, et `proveLoopClosed` sondait ce port même
  quand la boucle n'y avait rien lancé. Le port est désormais vérifié avant
  la revendication, et sondé seulement tant que `journeysStartedAt` marque
  l'état ;
- échec 20 (mineur) : un checkout enregistré disparu reçoit sa propre raison
  et la procédure de reprise décrite plus haut, au lieu du conseil de
  supprimer une copie ;
- échec 15 (mineur) : la documentation et l'en-tête du test affirmaient que
  `build-local.mjs` refusait déjà une migration modifiée pendant le build.
  C'est faux pour une migration ajoutée, fichier non suivi hors des portées
  de `buildSourceEvidence`. Le test existant de l'échec 15 crée justement une
  telle migration, et son commentaire le dit maintenant. Le comportement ne
  change pas.

Tests écrits d'abord, contre le code inchangé (`68ca4966`) : RED sous
Windows, 3 échecs, 12 réussis, 8 sautés ; sous WSL, 5 échecs, 18 réussis.
Chacun échoue pour sa raison. Un `start` sur un port tenu laisse `state.json`
en `cleanup-failed`, `devLoopCleanup.appPortClosed: false`, et l'erreur « The
dev loop was not provably closed » remplace « Local application port … is
unavailable ». L'état d'une boucle au repos est gardé à cause d'un serveur
sans rapport. Un checkout disparu est présenté comme une copie, en unitaire
comme par un vrai `stop`. Aucune marque n'est posée pendant les parcours.
GREEN : Windows 15 réussis et 8 sautés, WSL 23/23. Contrôle final avec
`ci-guardrails` et `local-supabase-ci` : Windows 53 réussis et 8 sautés, WSL
61/61. Typecheck et ESLint ciblé passent.

Runs natifs dans le clone WSL sur `d4a6bba4`, port applicatif 3187, sélection
`--grep HUB03`. Le « serveur sans rapport » est un `net.Server` Node lancé
depuis `/tmp` sur `127.0.0.1:3187`.

| Étape | Durée murale | Résultat |
| --- | --- | --- |
| `start` pendant qu'un serveur sans rapport tient 3187 | 1,2 s | code 1 ; le manifeste de session garde « Local application port 3187 is unavailable on 127.0.0.1 », sans `devLoopCleanup` ; aucun `state.json`, `status` : `absent` |
| `start` | 67,3 s | prêt |
| `run`, sans build | 5,7 s | 2/2 ; `journeysStartedAt` présent pendant les parcours (23 relevés, port ouvert puis refermé), absent ensuite |
| état copié dans un `git worktree` du clone : `status`, `stop` | < 0,3 s chacun | `foreign-checkout`, « copied or restored from another checkout » ; `stop` code 1, rien de signalé |
| même copie, `checkout` réécrit vers un chemin absent : `status`, `stop` | < 0,3 s chacun | `foreign-checkout`, « no longer exists (moved or renamed?) », « recover it by hand » ; `stop` code 1, rien de signalé ; superviseur vivant, socket et ports intacts, états inchangés |
| serveur sans rapport sur 3187, boucle au repos, `stop` | 2,2 s | code 0 : pile, registre et 8 ports fermés, `appPortClosed: null`, état retiré ; manifeste `stopped` |
| 2e boucle : `start`, `run` | 62,2 s + 5,2 s | prêt, 2/2, marque effacée |
| `kill -9` du superviseur pendant les parcours | — | l'état garde `journeysStartedAt` ; survivent le processus SDK `e2e`, `next-server` sur 3187 et les hôtes Supabase |
| `stop` | 11,8 s | code 1 : pile détruite (répertoire, registre, ports), `appPortClosed: false`, état en `cleanup-failed` |
| attente de 180 s | — | `next-server` orphelin écoute toujours sur 3187 ; arrêté à la main (identifié par son répertoire courant dans le clone) |
| `stop` ensuite | 0,2 s | code 0, `appPortClosed: true`, état retiré |
| 3e boucle : `start`, `run`, puis `kill -9` au repos | 62,3 s + 5,2 s | 6 ports de la pile ouverts, pas de marque |
| serveur sans rapport sur 3187, `stop` | 1,9 s | code 0 : `stop` détruit lui-même la pile, `appPortClosed: null`, état retiré |

Les itérations terminées et les manifestes de session écrits enregistrent
`qualification: false` et `privacy: passed` ; l'itération tuée garde déjà le
manifeste et le journal de son build. Journaux, états, manifestes, scripts et
`SHA256SUMS` : `.codex-tmp/e2e-dev-loop-20261018/review-followup/` du worktree
`miaouffrage-e2e-loop`.

Non exécutés : un checkout réellement déplacé pendant que son superviseur
tourne (procédure manuelle ci-dessus, non rejouée) ; macOS.

### Build de production et limite de heap

Tous les builds de production passent par `scripts/next-build.mjs`.
`npm run build` l'appelle directement : poste local, Vercel (`vercel.json`),
`verify:production` et Quality Gate. `build-local.mjs` (campagnes Army) garde
son tableau `buildCommands` et construit l'environnement de ses étapes avec la
même fonction `withNextBuildHeap()`, importée de `scripts/next-build-env.mjs`.
Ce module n'a pas d'effet de bord ; le lanceur, lui, démarre le build dès qu'il
est exécuté et n'est importé par aucun script. Il exécute `next build` avec le
Node courant, sans shell, depuis la racine du dépôt : la commande est identique
sous Windows, macOS, Linux, en CI et sur Vercel. Il renvoie le code de sortie
de Next et, hors Windows, relaie les signaux d'arrêt.

La limite est un plancher de **4096 Mio** de heap V8 (`--max-old-space-size`)
pour le processus Next et les enfants qui héritent de `NODE_OPTIONS`, dont
`tsc`. Next 16.4 vérifie TypeScript par la CLI `tsc`
(`experimental.useTypeScriptCli`, actif par défaut), lancée avec `process.env`
mais sans les arguments `node` du parent : seul `NODE_OPTIONS` lui transmet la
limite. Les workers propres à Next reçoivent déjà l'argument ; les workers de
génération statique retirent volontairement toute limite (`isolatedMemory`).
Sans limite, V8 dérive son plafond de la RAM de l'hôte : 2240 Mio dans la VM
WSL d'environ 12 Go, 4288 Mio sur le poste Windows de 64 Go mesuré (Node 24).
Contrôle WSL du 16/10 : argument seul → `tsc` sans `NODE_OPTIONS`, arrêt vers
2035 Mo de heap ; via le lanceur → `tsc` à 4096, pic RSS 3,0 Go, build complet
en 81 s. Un build peut donc passer sur un poste et échouer sur une machine plus
petite, ce que le plancher empêche.

Les autres options de `NODE_OPTIONS` (par exemple `--import` des gardes réseau)
sont conservées. Une limite supérieure déjà présente est conservée ; une limite
inférieure, absolue ou en pourcentage de la RAM, est relevée à 4096 Mio et
signalée par le lanceur, car elle reproduirait l'arrêt de `tsc` :
`[next-build] raised NODE_OPTIONS heap from … to 4096 MiB`. Mesuré sous Node 24 :
`--max-old-space-size-percentage` prime sur la valeur absolue quel que soit
l'ordre ; entre valeurs absolues, la dernière l'emporte. Le plafond borne
chaque processus, pas la mémoire totale ; voir le
[budget du build Army](tester-army-build-resources.md). Marge : `tsc` culmine à
2,9–3,0 Go de RSS ; une croissance d'environ un tiers du graphe de types
imposerait de remesurer et de relever le plancher.

Le manifeste de `build-local.mjs` enregistre `nodeOptions` (expurgé) et copie
`next-build-env.mjs` avec les scripts de recette. Le garde
`src/test/ci-guardrails.test.ts` refuse :

- un script `package.json`, la commande Vercel ou une ligne de workflow qui
  lancerait `next build` directement : nom nu, `npx next@<version>`, shim
  `.bin` tel que `next.cmd`, ou `next/dist/bin/next` ;
- tout lancement de `next build` sous `scripts/**` dont l'environnement ne
  provient pas de `withNextBuildHeap()` ;
- une limite inférieure conservée, absolue ou en pourcentage ;
- un lanceur qui n'atteindrait pas la CLI Next ou ne relèverait pas la limite
  (`next-build.mjs --help` avec `NODE_OPTIONS=--max-old-space-size=2048`).

Preuves du 16/10 sur la version finale, avec Node 24.19 et
`NODE_OPTIONS=--max-old-space-size=2048` hérité. Sous WSL Ubuntu 24.04, cache
froid : sans le lanceur, `tsc` s'arrête sur `heap out of memory` ; avec
`npm run build`, la limite est relevée et signalée, `tsc` reçoit 4096 (pic RSS
2,9 Go) et le build passe en 76 s. Sous Windows 11, le même `npm run build`
passe également (cache TypeScript chaud). macOS, GitHub Actions et Vercel
empruntent le même `npm run build` mais n'ont pas été exécutés pour cette
correction.

## Contrat défini avant implémentation

Les scénarios et échecs attendus ont précédé le code :

1. Refuser les options inconnues ou répétées, les valeurs vides ou invalides,
   un port occupé ou interdit au navigateur et une cible Supabase héritée, avant
   toute étape SQL/application. Réserver le futur port Next pendant l'allocation
   des services Supabase pour éviter une collision interne.
2. Réserver `--grep` à `critical`. Conserver SQL/RLS/build, le setup de connexion
   UI exact et au moins un scénario métier authentifié sur chaque cible ; aucun
   skip, succès après retry SDK ou filtre sans résultat ne vaut une réussite.
3. En dev, vérifier une connexion réelle au tableau de bord, une lecture API 200
   et une modification visible par HMR sans rechargement complet de la page.
4. Ne conserver ni mot de passe, ni jeton, ni adresse du compte dans les preuves.
   Aucune clé service-role ni URL PostgreSQL dans le fichier privé de connexion.
5. Vérifier l'arrêt des processus possédés, les ports IPv4/IPv6 libérés, la
   suppression de la pile et des identifiants après Ctrl+C comme après erreur.
   Un crash, timeout ou nettoyage forcé reste un échec.

## Validation exécutée

Les rejeux utilisent un checkout Linux isolé de `40ffb876` avec uniquement les
changements de ce lot. Les travaux concurrents du checkout Windows sont
préservés et ne sont pas qualifiés par ces résultats.

Ubuntu/WSL, Node 24, Army 0.21 : la connexion UI, la lecture API 200 et le HMR
passent **1/1**, sans skip ni retry. `performance.timeOrigin` reste identique.
Ctrl+C produit `stopped` / `e2e: not-run`, Next termine avec zéro et
`sourceChanged: true`. Le fichier HMR du clone jetable est ensuite restauré
octet pour octet. Permissions `0600`/`0700`, absence de processus possédés, ports
fermés et suppression de la pile et des identifiants sont vérifiées directement.
Le terminal Windows interrompu retourne 1 ; son code ne remplace pas ces constats
ni le manifeste terminal. Reçu :
`.codex-tmp/local-army-workflow-20261016/dev-qualified/receipt.json`.

Le port occupé et une origine Supabase héritée sont refusés avant toute étape.
ESLint ciblé, typecheck global et contrôle du diff passent. Les **63 contrôles**
des recettes et archives existantes passent, avec empreintes vérifiées :
`.codex-tmp/army-local-development-20261016/recipe-validation.json`.

Les résultats des nouveaux rejeux métier et des refus de sélection sont
archivés séparément du cycle interactif. Les anciennes campagnes complètes
critical/full/development ne qualifient pas ce nouveau lot de sources.

## Échecs rencontrés et conservés

- Le premier dev Linux passe SQL/RLS, puis `/login` répond 500 : le mode dev
  omettait `.e2e/army/tsconfig.json`. La préparation existante est maintenant
  commune au build, au wrapper Army et au dev. Le rejeu part d'un checkout neuf,
  sans configuration présemée. Timeout et nettoyage conservés dans
  `.codex-tmp/local-army-workflow-20261016/red-evidence/`.
- Le premier contrôle d'archive ne copiait pas cette nouvelle dépendance dans
  sa fixture. Sa copie a été ajoutée ; les douze assertions restent inchangées.
- Un filtre pouvait sélectionner uniquement deux tests anonymes et satisfaire
  le précédent seuil de deux résultats. La collection RED précède le correctif
  qui exige le setup exact réussi et un scénario métier authentifié. Reçus :
  `.codex-tmp/army-local-development-20261016/review-anonymous-filter-red.json`
  et `report-validator-compatibility.json`. La relecture des rapports historiques
  3/3, 122/122 et 4/4 confirme leur compatibilité, sans nouvelle qualification.
- Un adaptateur de manifeste ancien a interrompu un essai intermédiaire. Cet
  échec de préparation est conservé et ne compte pas comme preuve produit.
- Le premier positif sur l'allocateur final est interrompu par un redémarrage
  WSL pendant le build, après SQL/RLS. Le journal signale un arrêt non propre,
  sans cause attribuée. Aucun manifeste terminal n'a été écrit : cet essai ne
  prouve ni réussite métier ni nettoyage normal. Les traces et la récupération
  de sa seule pile possédée sont conservées séparément d'un éventuel rejeu.
  Reçu : `.codex-tmp/local-army-workflow-20261016/critical-allocator-interrupted/receipt.json`.
  La récupération exécute `stop` puis `stack destroy` sur son identité exacte,
  vérifie neuf ports fermés ainsi que le retrait du registre et du répertoire.
  Ce nettoyage après arrêt OS ne vaut pas exécution normale du `finally`.

### Collision de port du runtime natif

Un lancement a échoué sur le bind de l'inspecteur Functions à
`127.0.0.1:43899`. Le détenteur à cet instant n'a pas été observé. L'ancien
allocateur écoutait sur le port zéro puis fermait la socket avant le démarrage.
Le noyau choisissait ainsi dans la plage des connexions clientes automatiques
(`32768–60999` sur cet hôte). Une réutilisation dans cette fenêtre est plausible,
sans attribution certaine. Voir le
[contrat du noyau Linux](https://docs.kernel.org/networking/ip-sysctl.html#ip-local-port-range-2-integers).

Avant de corriger l'allocateur, les régressions ont défini : huit ports distincts
et réécoutables, exclusion des plages éphémères lues sur l'hôte et d'un port
réellement occupé, refus d'une plage invalide ou de candidats épuisés, échec
sans retry et nettoyage après collision au démarrage. L'isolation est justifiée
car un navigateur ne peut imposer le choix du noyau ni une collision dans cette
fenêtre. Les tests utilisent de vraies sockets, sans mock de `net`.

Le RED compte trois échecs sur treize ; le correctif passe **13/13**. Une tentative
sandbox bloquée avant Vitest (`EPERM`) n'est pas comptée comme RED métier.
Rapports : `.codex-tmp/army-local-development-20261016/port-allocation-red-complete.json`
et `port-allocation-green.json`.

L'allocateur lit les plages Linux ou Darwin sans changer de réglage global,
exclut les ports déjà attribués et commence à un candidat aléatoire. Chaque
candidat est réellement écouté puis libéré ; seul `EADDRINUSE` permet d'en essayer
un autre pendant la préparation. Un conflit ultérieur au démarrage reste un
échec conservé, sans relancer la campagne. macOS n'a pas été exécuté.

L'élargissement aux ports non éphémères a également exposé deux modes d'échec
avant leurs correctifs : le futur port Next, encore libre, pouvait être attribué
à Supabase ; les ports `6000`, `6667` et `10080`, valides pour une socket, restent
interdits au navigateur. La réservation du port applicatif est transmise à la
préparation de la pile. Les ports interdits supérieurs à 1023 sont exclus par
une liste commune à l'allocateur et au parser, fondée sur les
[restrictions Chromium](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc).
Les cas déterministes ont précédé chaque correction :
`port-application-reservation-red.json` et `port-browser-red.json` sous
`.codex-tmp/army-local-development-20261016/`.
Leur rejeu final passe **15/15** sans skip (`port-allocation-final-green.json`).
Les trois ports HTTP interdits sont aussi refusés par la vraie entrée CLI avant
création de manifeste ou démarrage, dans `port-browser-cli-green.json`.

### Cause des arrêts WSL et correction de l'environnement

Les journaux Windows ont ensuite établi la saturation de mémoire engagée :
trois événements `Resource-Exhaustion-Detector / 2004`, aux `00:20:51Z`,
`00:22:32Z` et `00:28:46Z`, montrent environ **99,6 %** de la limite de commit
atteinte. La RAM physique utilisée n'était que de 41 à 43 Go. Aucun fichier
d'échange Windows n'était actif et sa gestion automatique était désactivée.
Les événements et l'état initial sont conservés sous
`.codex-tmp/wsl-reliability-20261016/`. Voir le
[diagnostic Microsoft du commit](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-application-service-memory-leaks).

La gestion automatique du fichier d'échange Windows est réactivée et relue.
Avant le redémarrage Windows, la liste des fichiers actifs reste vide et la
limite effective n'a pas augmenté.
`pagefile-repair-result.json` distingue explicitement ces états ; aucun
redémarrage du PC n'a été lancé automatiquement.

Les deux distributions étant arrêtées, une nouvelle `.wslconfig` est créée
avec **12 Go de mémoire, 8 processeurs et 8 Go de swap**, sans écraser de fichier
préexistant. Ces paramètres sont globaux à toutes les distributions WSL2.
La lecture Linux confirme `MemTotal: 12249308 kB`, `nproc: 8` et un swap actif
de `8589934592` octets. Le reçu `wslconfig-applied.json` conserve l'identité du
fichier. Voir la [configuration Microsoft WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

Le [budget du build Army](tester-army-build-resources.md) est également réduit
de 8192 à **4096 Mio de heap V8 par processus**, sans désactiver TypeScript,
OpenAPI ni les budgets de performance. Ce plafond n'est pas une borne de mémoire
totale. Les 63 contrôles de recettes passent avant et après le changement.
Les nouveaux rejeux doivent utiliser ce nouveau gel de sources ; les résultats
antérieurs restent distincts. La mémoire engagée Windows est mesurée pendant
ces essais, avec une marge initiale supérieure à 16 Gio.

Sur ce gel, la campagne ciblée termine **3/3** : connexion, création et
duplication, avec les assertions financières existantes et le rechargement.
SQL (1253 assertions), RLS (deux tests), compilation complète et budgets passent.
Sources et build restent figés ; le boot WSL ne change pas et le swap reste à
zéro. Reçu `critical-positive-resources/receipt.json` sous
`.codex-tmp/local-army-workflow-20261016/`, 58 empreintes revérifiées.

Les deux refus sont exécutés sur le même gel et restent des **échecs explicites**
de campagne : `critical-no-match-resources/receipt.json` conserve `NO_TESTS`
(SDK 2, CI 1), après SQL/RLS/build réussis ;
`critical-anonymous-only-resources/receipt.json` conserve deux tests anonymes
réussis, mais une CI à 1 car le setup exact et un scénario métier authentifié
manquent. Aucun de ces refus n'est présenté comme campagne métier réussie.
Neuf et vingt empreintes sont revérifiées, confidentialité validée, zéro skip,
ports libérés et piles supprimées. Les trois passages gardent le même boot ID.

L'utilisateur a choisi de redémarrer lui-même Windows après les tests. La
vérification du fichier d'échange actif (`Win32_PageFileUsage`) et d'une limite
de commit augmentée est consignée ci-dessous ; sa seule configuration
enregistrée ne constituait pas cette vérification.

Le dernier cycle dev passe aussi sous ces limites : SDK **1/1**, connexion UI,
HMR visible avec `performance.timeOrigin` inchangé, puis Ctrl+C. Le manifeste
termine `stopped` / `e2e: not-run`, Next sort à zéro, les ports IPv4/IPv6 sont
libérés, la pile et les identifiants privés sont supprimés et aucun processus
possédé ne reste. La source HMR du clone est restaurée exactement. Reçu :
`dev-qualified-resources/receipt.json`, seize empreintes revérifiées, zéro
détection de secret et même boot ID avant/après.

La mesure Windows couvre les quatre cycles, de `00:37:00Z` à `00:52:45Z` :
409 échantillons, pic de commit `57139560448` octets pour une limite de
`66094223360` (environ **86,5 %**), marge minimale `8954662912` octets,
aucun nouvel événement 2004. Le moniteur est arrêté après les essais.
Synthèse : `.codex-tmp/wsl-reliability-20261016/host-monitor-summary.json`.
Les deux interruptions restent archivées séparément. Ces résultats portent
sur les charges mesurées pendant les quatre cycles.

L'index `resources-replays-index.json` conserve les quatre reçus et 116 fichiers
sous `.codex-tmp/local-army-workflow-20261016/` ; leurs empreintes sont toutes
revérifiées. `final-cleanup-resources.json` confirme quatre piles retirées,
aucun registre ni processus possédé restant, 25 ports fermés et les identifiants
supprimés. Synthèse finale et références croisées :
`.codex-tmp/wsl-reliability-20261016/final-proof.json`.

### Vérification après le redémarrage utilisateur

Le 16 octobre 2026, dix contrôles en lecture seule passent après le nouveau
démarrage Windows (`08:03:21Z`). `C:\pagefile.sys` est actif en gestion
automatique, avec **28672 Mio (28 Gio)** alloués. La limite de commit effective
est passée de `66094223360` à `96158994432` octets, soit environ **61,6 à 89,6 Gio**.
Elle est utilisée à 20 % au moment du contrôle ; aucun événement 2004 n'est
présent depuis ce démarrage et la requête des journaux réussit.

La configuration WSL conserve son empreinte. La lecture Linux confirme à nouveau
`12249308 kB` de mémoire, huit processeurs et `8388608 kB` de swap, inutilisé.
L'attente d'activation du fichier d'échange est donc levée. Les campagnes Army
ci-dessus conservent leur date et leur portée antérieures au redémarrage.

Reçu : `.codex-tmp/wsl-reliability-20261016/post-restart-20261016/verification.json`.
Les anciennes preuves restent inchangées ; les deux documents dans leur état
précédent sont sauvegardés dans ce même dossier. Une première génération de
reçu a échoué sur une conversion de date PowerShell : son statut erroné est
explicitement invalidé et conservé dans `invalid-attempt-disposition.json`,
sans entrer dans les dix contrôles réussis du reçu corrigé.
