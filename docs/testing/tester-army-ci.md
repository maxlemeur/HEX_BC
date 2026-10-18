# TesterArmy métier sur une base CI éphémère

## Sélection par impact des parcours critical

Décision du 17/10/2026 : une pull request ne lance que les parcours TesterArmy
critical que ses fichiers atteignent. La suite critical complète tourne à chaque
push de code sur `main` et chaque nuit. Demande du 18/10/2026 : les parcours du
métré (`e2e/army/takeoff/**`), lancés jusque-là par la seule suite full, entrent
dans la carte et sont lancés par la PR qui les atteint (job `army-takeoff`,
[ci-dessous](#parcours-du-métré-fullonly)).

| Événement | Parcours critical (`army-critical`) | Parcours du métré (`army-takeoff`) | Build Army |
| --- | --- | --- | --- |
| Pull request, documentation seule ou chemins hors suite | aucun (`none`) | aucun (`none`) | non |
| Pull request, autres chemins | fichiers sélectionnés (`files`) ou suite complète (`full`), répartis en shards ([jobs parallèles](#jobs-parallèles)) | fichiers atteints (`files`), aucun, ou tous (`all`) si la décision critical est `full` | oui, par job lancé |
| Push sur `main` | suite complète, sauf push de documentation seule (aucun) | aucun : la nuit les lance | oui, sauf documentation |
| `workflow_dispatch`, label `army-full` | suite complète | tous (`all`) | oui |
| Nuit, 03:15 UTC (`e2e-army-full.yml`) | phase `full` en shards : tous les parcours critical, plus extended et takeoff ; phase développement dans son propre job | (compris dans la phase `full`) | oui, par shard |

### Décision

`scripts/tester-army/select-journeys.ts` tourne avec Node seul, avant `npm ci`,
et lit la carte versionnée `scripts/tester-army/army-impact-map.json`. Sur une
pull request, le diff est celui du commit de fusion que GitHub teste contre son
premier parent, la pointe de la base : ce sont les changements de la PR
(`base...head`), avec un checkout de profondeur 2. L'étape vérifie que le second
parent est bien la tête de la PR ; sinon, suite complète. Sur un push, le diff
est `before...after`.

Pour chaque chemin modifié :

1. `docs` (`docs/**`, `maquette/**`, `**/*.md`) : rien à lancer. Sur un push,
   tout autre chemin lance la suite complète.
2. `full` (manifestes npm, `next.config.ts`, `tsconfig.json`, `e2e.config.ts`,
   fixtures et setup des parcours, runners et build Army, `src/proxy.ts`,
   `src/app/layout.tsx`, `src/lib/auth/**`, moteur de calcul et snapshot v2,
   types de base, migrations, configuration Supabase, ce workflow), ou fichier
   importé par le runner critical : suite complète.
3. Sinon, la fermeture d'impact du chemin : les fichiers qui l'importent,
   transitivement, et pour une route API les fichiers dont le code nomme son
   chemin `/api/...` (chaînes statiques ; un `${...}` final compte comme un
   sous-chemin, sauf s'il ferme un argument d'appel direct).
   - Un membre couvert par `full` (hors `scripts/**`, outils de build) : suite
     complète. Une dépendance de la racine applicative, de l'auth, du moteur de
     calcul ou des fixtures change tous les parcours.
   - Chaque règle (`rules`) atteinte ajoute ses parcours (`@groupe`, `*` pour
     tous) ; un fichier de parcours s'ajoute lui-même.
   - Chaque point d'entrée atteint (fichier que rien ne charge : page, route,
     script, parcours) doit être couvert par une règle, `full` ou `nonRuntime` ;
     sinon, suite complète.
4. Seulement des points d'entrée `nonRuntime` (tests, outils d'autres suites) :
   rien à lancer.

Un chemin `full` ou non cartographié impose la suite complète ; aucun parcours
atteint donne `none`. Sinon, le setup `auth.setup.e2e.ts` est toujours ajouté,
et le parcours d'ancrage `stale-save.e2e.ts` quand seuls des parcours anonymes
sont retenus (le runner exige un test métier authentifié). Si tous les parcours
sont retenus, c'est la suite complète.

Repli sûr : toute erreur git (révision absente du checkout, `before` d'un push
non récupéré), carte illisible ou invalide, diff vide ou événement inconnu donne
la suite complète. Une carte dont `suite.journeys` diffère des parcours que la
CI lance (liste `localBusiness` de `e2e.config.ts` appliquée aux fichiers du
checkout, ou liste illisible) est invalide : un parcours ajouté sans être
inscrit ne serait jamais sélectionné. Seule une sortie explicite `none` saute
les parcours : une sortie vide ou absente lance la suite complète.

### Preuve d'une exécution filtrée

La sélection passe par `--files` à `run-tester-army-ci.ts critical`, qui la
transmet au CLI e2e comme fichiers positionnels (le filtre `--tag critical` et
le setup de connexion restent appliqués). Le manifeste enregistre
`scope: filtered-critical` et `journeyFiles` (la clé `files` y reste
l'inventaire SHA-256 des preuves). Le run échoue si un fichier demandé n'a
pas tous ses tests exécutés et réussis, ou si un autre fichier que ceux-là et le
setup s'exécute. L'artefact `army-critical-selection` (`selection.json`, schéma
`army-impact-selection-3` : événement, révisions, SHA-256 de la carte, décision
par chemin, plan des shards) et le résumé de l'étape gardent le motif, y compris
pour `none`. Une exécution filtrée ne prouve que ses fichiers ; elle ne qualifie
pas la suite complète.

### Parcours du métré (`fullOnly`)

Les huit fichiers `e2e/army/takeoff/*.e2e.ts` ne sont lancés que par la
sélection full de `e2e.config.ts`. Avant ce changement, une PR qui les touchait
(PR #39 : import CSV fournisseur US-4.1, -b, -c, page prix de l'affaire) ne
lançait que `dashboard-ux` et devait attendre ou déclencher la suite full de
30 min pour trois parcours d'une dizaine de secondes.

- Carte : section `fullOnly`, dont `globs` reprend tel quel le glob takeoff de
  la liste full de `e2e.config.ts` et `journeys` liste exactement ses fichiers.
  Les règles y renvoient comme aux parcours critical, par groupes :
  `takeoff-hub` (connexion par la liste des affaires, hub et ses sous-routes),
  `takeoff-affaire-takeoff` (métré de l'affaire), `takeoff-wizard` (assistant de
  création puis éditeur), plus `affaire-prices` (US-4.1), `estimate-takeoff`
  (`contracts.e2e.ts`), `purchase-orders` (US-4.4), `dpgf-pages` (US-2.1, US-2.2)
  et `tabular-pdf-fixture` (`us22_live_tabular.pdf`). `*` (coquille applicative)
  les atteint aussi ; un fichier du métré, ou un module qu'il importe ou dont il
  nomme la route `/api/...`, se sélectionne lui-même par le graphe.
- Décision (`selection.json`, champ `fullOnly`, schéma
  `army-impact-selection-3`) : sur une PR, les fichiers atteints plus le setup
  de connexion (`files`), ou `none`. Dès que la décision critical est `full`
  (chemin partagé ou non cartographié, diff vide, label `army-full`,
  `workflow_dispatch`, erreur, ou changements qui atteignent tous les parcours
  critical), tous les parcours du métré (`all`). Sur un push,
  `none` : le contrôle après fusion reste la suite critical, la nuit lance le
  métré. Repli sûr : la liste `all` est relue dans l'arbre de travail par les
  globs de la carte, si bien qu'un parcours ajouté sans être inscrit tourne quand
  même (et la carte, invalide, impose la suite critical complète) ; une liste
  impossible à établir (carte illisible) donne un `all` vide, que le job lance
  comme la sélection full entière.
- Chemins transmis au runner : le motif `FULL_ONLY_JOURNEY_FILE` de
  `scripts/tester-army/journey-files.mjs` (lu par le sélecteur) accepte, comme
  le glob `e2e/army/takeoff/**`, un parcours dans un sous-dossier
  (`e2e/army/takeoff/metre/x.e2e.ts`) et refuse `..`, les entrées commençant
  par `.` ou `_`, les espaces et tout autre dossier. Un parcours du métré que ce
  motif refuserait rend la carte invalide, et le repli donne alors un `all` vide
  (sélection full entière) plutôt qu'une liste que le runner rejetterait avant
  de rien lancer. Les deux runners acceptent `FULL_JOURNEY_FILE`, qui le
  contient et ajoute les autres dossiers de la sélection full pour ses
  [shards](#jobs-parallèles).
- Job `army-takeoff` de `e2e-army-critical.yml`, en parallèle des shards
  critical (son seul `needs` est le job de sélection `army-select`, dont il lit
  les sorties : une seule décision pour les deux, le garde l'exige) : même garde
  de cible, puis, sauf sortie explicite `none`, installation, caches
  restaurés seulement (build et instantané de base) et
  `run-tester-army-ci.ts full --files <setup,parcours>`, à 1 worker comme la
  suite full où ces parcours sont qualifiés. Le manifeste enregistre
  `scope: filtered-full`, `journeyFiles` et `phasesNotRun.development` ; le run
  échoue si un fichier demandé n'a pas tous ses tests exécutés et réussis ou si
  un autre fichier que ceux-là et le setup s'exécute. Preuves :
  `army-takeoff-evidence` ; la sélection reste dans `army-critical-selection`.
- Coût : rejouée sur les 15 dernières fusions de `main`, la sélection donne 11
  décisions `full`, donc 11 jobs `army-takeoff` complets (8 fichiers), et 4
  `none`. Le job ajoute des minutes de runner, pas de durée murale tant qu'il
  reste plus court que la suite critical ; mesure locale du lot complet dans la
  section [Mesures](#mesures). Mesuré sur la PR #42 (décision critical `full`,
  donc métré `all` : setup et huit fichiers ; cache webpack restauré par
  préfixe de clé depuis `main`, instantané de base exact) : job
  `army-takeoff` de 8 min 22 s (run
  39089316945, tête `9467ba95`) et de 8 min 18 s (run 39096480206, tête
  `964775bc`), contre 12 min 15 s et 12 min 39 s pour `army-critical` dans les
  mêmes runs, donc sans durée murale ajoutée.

### Exécution full ciblée (`workflow_dispatch`, `grep`)

Prouver quelques parcours de la sélection full (métré, extended, `local`) sans
la suite de 30 min : Actions → TesterArmy Full → Run workflow, sur la branche,
avec le champ `grep` (motif `--grep` des titres de tests, describe et test
joints par une espace), ou :

```sh
gh workflow run e2e-army-full.yml --ref <branche> -f grep='^VNEXT Team B - user stories e2e US-4\.1'
```

GitHub ne déclenche que les workflows présents sur la branche par défaut ;
`e2e-army-full.yml` y est déjà, et un déclenchement sur une branche exécute la
version du fichier de cette branche, entrée `grep` comprise.

Le motif passe par `env` puis une expansion entre guillemets, jamais collé dans
le script (garde `src/test/ci-guardrails.test.ts`). Le runner refuse un motif
vide, invalide ou commençant par `-`. Une exécution filtrée lance la seule
phase `full` (le setup de connexion compris), pas la phase développement ; le
manifeste enregistre `scope: filtered-full`, `grep` et
`phasesNotRun.development`, et une annonce de l'exécution filtrée apparaît dans
le résumé du job. Elle ne prouve que ses tests retenus et ne qualifie pas la
suite full : son titre de run (« TesterArmy Full (filtré --grep, non
qualifiant) »), son contrôle sur le commit (`army-full (filtré --grep, non
qualifiant)`) et son artefact (`army-full-filtered-evidence`) le disent. La
planification de 03:15 UTC n'a pas d'entrée : elle reste la suite full
complète, phase développement comprise, et garde les noms qualifiants
« TesterArmy Full », `army-full` et `army-full-evidence`, comme un
déclenchement sans motif. En local, le même filtre :
`npm run e2e:army:ci -- full --grep '<motif>'`, ou
`npm run e2e:army:ci -- full --files e2e/army/critical/auth.setup.e2e.ts,e2e/army/takeoff/<parcours>.e2e.ts`
(sous-dossiers acceptés). La boucle d'itération `npm run e2e:army:dev-loop`
([développement local](tester-army-local-development.md)) ne sert que des
parcours critical : les parcours du métré passent par ce filtre full, et le
superviseur de la boucle refuse `--grep` et `--files` (chaque `run` choisit
sa sélection).

### Forcer la suite complète

- Poser le label `army-full` sur la PR, puis pousser un commit : le label est
  lu au déclenchement. Le poser seul ne relance rien, et relancer un job réutilise
  les labels de l'événement d'origine.
- Ou Actions → TesterArmy Critical → Run workflow sur la branche
  (`workflow_dispatch`) : suite complète sur la tête de la branche, pas sur le
  commit de fusion.

### Maintenir la carte

Le garde `src/test/army-impact-map.test.ts` (projet Vitest `node`, donc Quality
Gate) échoue si : un parcours critical de la CI (liste `localBusiness` de
`e2e.config.ts`) manque à `suite.journeys` ; aucune règle n'atteint un parcours ;
la carte nomme un fichier absent ou un glob qui ne correspond à rien ; un chemin
`full` exigé ou un repli sûr change ; une fixture lue par un parcours ne lui est
pas routée ; le workflow saute les parcours pour autre chose que `none`, ou
déplace `E2E_ARMY_WORKERS` ou l'enregistrement du cache. Pour le métré, il
échoue aussi si : `fullOnly.journeys` diffère des fichiers du glob takeoff de la
liste full de `e2e.config.ts`, ou ce glob n'y figure plus ; un parcours du métré
n'est atteint par aucune règle ; une décision incertaine ne les lance pas tous ;
la sélection transmet un chemin que `full --files` refuse (sous-dossier
compris) ; le job `army-takeoff` saute pour autre chose que `none`, ne lit pas
la décision du job `army-select`, fixe un nombre de workers ou enregistre
un cache. Les shards ont leurs propres gardes ([jobs parallèles](#jobs-parallèles)).
Sans protection de branche (plan Free), un Quality Gate rouge n'empêche pas une
fusion : le contrôle de complétude des parcours est donc aussi fait par le
sélecteur à chaque exécution (repli sûr ci-dessus).

À l'ajout d'un parcours critical : l'inscrire dans `suite.journeys` et dans une
règle ou un groupe ; sinon chaque exécution du sélecteur lance la suite
complète. D'un parcours du métré : l'inscrire dans `fullOnly.journeys` et dans
une règle ou un groupe `takeoff-*` ; non inscrit, il tourne quand même (repli
`all`) avec la suite critical complète. D'une page ou d'une route : la couvrir par une règle, sinon
tout changement qui l'atteint lance la suite complète. D'une route API sans
appelant UI : `api-without-ui-caller`. D'une fixture lue par chemin : une règle
vers ses parcours. Voir la sélection d'une branche :

```sh
node scripts/tester-army/select-journeys.ts --event pull_request --base origin/main --head HEAD
```

### Caches et parallélisme

- Cache webpack du build Army `.e2e/army/next/cache`, hors empreinte du build
  (`build-local.mjs`) : restauré par chaque shard critical et full, `army-takeoff`
  et chaque phase calc-v3, depuis le dernier enregistré par `main` (clé
  `army-next-<OS>-<hash package-lock.json et next.config.ts>-<sha>`) ; seul le
  shard 1 d'un push sur `main` enregistre le sien (tous les shards construisent
  la même source).
- `E2E_ARMY_WORKERS: "2"` dans l'environnement de la seule étape des parcours
  critical, donc de chaque shard critical
  ([qualification](tester-army-local-development.md)). Les shards de la suite
  full, le job `army-takeoff` et les phases calc-v3 restent à 1 ; le parallélisme
  ajouté passe par les shards, chacun sur sa pile et son compte
  ([jobs parallèles](#jobs-parallèles)).
- Ctrl+S au lieu de l'autosave à 60 s dans les parcours qui ne qualifient pas
  l'autosave : seul « creation persists … after reload »
  (`estimate-integrity.e2e.ts`) garde l'attente réelle du cycle automatique
  ([cas couverts](tester-army-estimate-cases.md)). `AUTOSAVE_DEBOUNCE_MS` reste
  à 60 000 ; aucun changement produit.
- Instantané de base pré-migrée (`src/test/database-snapshot.ts`), opt-in par
  `ARMY_DB_SNAPSHOT_DIR`, que seules les étapes des parcours critical et du
  métré (`e2e-army-critical.yml`) fixent à
  `${{ runner.temp }}/army-db-snapshot`. Clé interne : SHA-256 des migrations,
  des seeds, du gabarit `config.toml` isolé, de la version du CLI Supabase, du
  bundle PostgreSQL et du format. Absent ou périmé : `db reset`, contrôle des
  migrations appliquées, puis `pg_dump` de la base avant pgTAP et avant tout
  compte de test. Présent : `pg_restore` à la place du `db reset`, puis contrôle
  des migrations appliquées, de l'empreinte du catalogue (schémas, droits,
  fonctions, politiques, données…) et de l'état propre à la pile ; tout écart
  ou toute erreur retombe sur un `db reset` journalisé. pgTAP et la matrice RLS
  s'exécutent toujours. Le manifeste du run enregistre `database.provenance`
  (`source` `reset` ou `snapshot` ; `snapshot` `disabled`, `recorded`,
  `not-recorded`, `restored` ou `rejected` ; clé ; motif) dès que la base est
  prête, avant pgTAP : un run qui échoue ensuite (pgTAP, matrice RLS,
  parcours) la garde. Un échec antérieur (démarrage de la pile, `db reset`) ne
  la laisse que dans `database.log`, qui journalise chaque décision. Cache
  GitHub : restauré par chaque shard critical (et par `army-takeoff`) sur la clé
  exacte `army-db-snapshot-v1-<OS>-<arch>-<hash des entrées>`, enregistré
  seulement par le shard 1 d'un push sur `main` quand la clé exacte est absente du cache
  (miss). Une clé GitHub est immuable : si une restauration y est rejetée, chaque
  run retombe sur `db reset` sans pouvoir la remplacer ; incrémenter alors
  `army-db-snapshot-v1` dans le workflow. `e2e-army-full.yml`,
  `e2e-army-calc-v3.yml` et `e2e-rls-matrix.yml` ne le définissent pas : un
  `db reset` complet tourne chaque nuit.

### Mesures

Référence avant ces changements (analyse du 17/10/2026) : chemin critique d'une
PR 16 min 13 s, tenu par `army-critical` (parcours 11 à 12 min à 1 worker,
build 130 s sans cache, installation 54 s, démarrage Supabase 21 s, sept
attentes d'autosave de 60 s) ; Quality Gate 2 min 24 s.

Mesures locales du 17/10/2026, indicatives : WSL Ubuntu 24.04 (24 cœurs,
31 Go), `run-tester-army-ci.ts critical`, `E2E_ARMY_WORKERS=2`, modifications
non commitées sur `3d8d2f8a` ; ni `npm ci`, ni Chromium, ni téléchargement de
cache. Durées lues sur les horodatages du journal du runner.

| Étape | Run 1 : `--grep` des parcours passés à Ctrl+S | Run 2 : `--files` d'une PR sur `useEstimateEditorBulkController.ts` |
| --- | --- | --- |
| Sélection | 6 tests + setup (`filtered-critical`) | 14 fichiers sur 20, setup compris : 31 tests (`filtered-critical`, `journeyFiles`) |
| Base de données | instantané absent : `db reset` 8,3 s, enregistrement 0,5 s, étape 9,5 s | instantané restauré 1,8 s, contrôles 0,5 s, étape 2,7 s |
| Build Army | 80,5 s, sans cache | 45,4 s, cache webpack du run 1 (même source) |
| Parcours | 90 s ; autosave 65 s (attente réelle conservée), les 5 autres 6 à 9 s | 131 s ; 31/31 verts |
| Run complet | 194 s, vert | 195 s, vert |

- Ctrl+S : chaque parcours concerné dure 6 à 10 s en tout, au lieu d'attendre
  au moins 60 s le cycle automatique ; les six preuves
  `save-shortcut-<versionId>` notent « En attente » avant le raccourci.
- Base : `db:ci:local` seul, à la mise au point de l'instantané, donnait 9,8 s
  sans instantané et 2,5 s avec.
- Build : en CI le cache vient du dernier commit de `main`, pas de la même
  source ; le gain local est un plafond.
- Run 2 sert aussi de preuve du chemin `--files` de bout en bout et des
  parcours sur une base restaurée.
- Run 3, sur l'état fusionné non commité (`origin/main` `141218a9` + cette
  branche + inscription dans la carte des trois parcours `bulk-*` de #25) : même
  sélection, 17 fichiers sur 23 ; 38/38 verts à 2 workers, dont les 7 tests
  `bulk-*` ; base restaurée, étape 2,6 s ; build 77 s sans cache ; parcours
  153 s ; run 247 s.

Parcours du métré, mesure locale du 18/10/2026 (WSL Ubuntu 24.04, Node 24.14.0,
clone `~/miaouffrage-ci-proofs` à `b47b91b7`, sans modification locale ; une
autre session faisait tourner une pile native en même temps) :
`run-tester-army-ci.ts full --app-port 3141 --files` avec le setup et les huit
fichiers du métré (la liste `all` du sélecteur) : `db reset`, pgTAP et RLS
verts, build 80,7 s (cache webpack local), parcours 123,9 s, 39/39 réussis
(setup et 38 tests), aucune phase développement (`phasesNotRun`), run complet
233 s, confidentialité passée. Preuve :
`.e2e/army/ci/2026-10-18T00-57-15-780Z-full/` du clone (`manifest.json`
SHA-256 `63d47b7512ccc5a74d2a335828151b9508a348da273af223b51002ba788cdd07`). Le
job `army-takeoff` d'une PR `full` coûte donc environ 2 min de parcours en plus
de l'installation, de la pile et du build ; en CI, le job entier mesure environ
8 min 20 s (coût du job `army-takeoff` plus haut).

Exécution full ciblée, même hôte et même révision :
`run-tester-army-ci.ts full --app-port 3141 --grep '^VNEXT Team B - user stories e2e US-4\.1'`
(le motif de la PR #39) : build 48,8 s, parcours 10,9 s, 4/4 (setup, US-4.1,
US-4.1b, US-4.1c), `scope: filtered-full`, `grep` et `phasesNotRun` au
manifeste, run complet 89 s, contre une suite full d'environ 30 min en CI.
Preuve : `.e2e/army/ci/2026-10-18T01-03-08-809Z-full/` du clone
(`manifest.json` SHA-256
`997242a353a12d0e69f55bafa9a75f07cdb6956d9f0fb7da1c6246de3578b7e0`).

Parcours du métré dans un sous-dossier, même hôte, révision `9546e7d5` : copie
temporaire non versionnée de `contracts.e2e.ts` dans
`e2e/army/takeoff/nested-proof/` (imports relatifs ajustés, titres préfixés
`NESTED`, SHA-256
`9f3aee5017fa0749a6e6b5bc4a308110b5873a52fe77585be7ada55f42c3ea46`), puis
`run-tester-army-ci.ts full --app-port 3141 --files e2e/army/critical/auth.setup.e2e.ts,e2e/army/takeoff/nested-proof/contracts.e2e.ts` :
`db reset` 8,4 s, pgTAP et RLS verts, build 45,7 s (cache webpack local),
parcours 25,9 s, 9/9 (setup et les 8 tests du fichier imbriqué ; 151 tests
découverts), `scope: filtered-full`, run complet 99 s, confidentialité passée.
Preuve : `.e2e/army/ci/2026-10-18T01-54-16-965Z-full/` du clone
(`manifest.json` SHA-256
`f327384ae8f93bcf338e859369d7dccd3d270b9160638cb56fbf2a5a48cff7fc`). La copie,
non suivie par git, n'entre pas dans `source.diffSha256`, qui ne couvre que les
fichiers suivis ; elle a été supprimée après le run.

Après la fusion de `origin/main` `488382d5` (PR #44, éditeur v3 de 2.6 ; PR #43,
boucle d'itération), même hôte, clone à `daa14ed3` sans modification locale
(`diffSha256` `e3b0c442…b855`), 250 migrations :
`run-tester-army-ci.ts full --app-port 3142 --files e2e/army/critical/auth.setup.e2e.ts,e2e/army/takeoff/contracts.e2e.ts`
(`contracts.e2e.ts` appartient au groupe `takeoff-wizard` que les fichiers
de l'éditeur v3 atteignent) : `db reset` 7,6 s, pgTAP (`Files=20, Tests=1854`)
et RLS verts, build 38,1 s (cache webpack local), parcours 26,5 s, 9/9,
`scope: filtered-full`, `phasesNotRun.development`, run complet 86,9 s,
confidentialité passée. Preuve : `.e2e/army/ci/2026-10-18T04-32-02-670Z-full/`
du clone (`manifest.json` SHA-256
`f50ce808d671cde4ac821ece3a99d5fdb15008b88d2ed7c50b4bd628ea0db100`). La boucle
de #43 sur la même révision (`start --app-port 3143`, 83,5 s ; `run --grep
HUB03` 2/2 en 7,0 s ; `run --files e2e/army/critical/hub-plans-card.e2e.ts`
4/4 en 14,8 s, sans reconstruction ; `stop` 3,2 s, pile, entrée du registre et
ports retirés) n'est pas une qualification ; pendant qu'elle était ouverte, ce
même `full --files` a été refusé avant toute pile.

Ces runs ne prouvent pas le full non filtré de l'arbre fusionné (phase `full`
puis phase développement, `scope: full`), et aucun job de PR ne le prouve :
`army-critical` lance `critical`, `army-takeoff` lance `full --files`
(`filtered-full`), et `e2e-army-full.yml` n'a pas de déclencheur
`pull_request`. Ce chemin, que la fusion modifie (`fullPhases` de cette branche,
`RunContext` de #43), est prouvé par un déclenchement d'`e2e-army-full.yml`
sans motif sur la tête fusionnée poussée ; son run et son manifeste
(`scope: full`, phases `full` et `development` réussies, aucun `phasesNotRun`)
restent à consigner ici ; le commit qui les consigne devient la nouvelle tête
et doit dire qu'il ne modifie que la documentation par rapport à la tête
prouvée. De même, le run calc-v3 de la PR 39096480257 (tête
`964775bc`, sélection `nightly`, six phases vertes dont `resume` avec GR06, voir
[GR06 en CI](tester-army-calc-v3.md#gr06-en-ci)) précède la fusion de
`488382d5` : seul le run calc-v3 de la PR sur la tête fusionnée poussée vaut
pour l'arbre fusionné, GR06 compris face à l'éditeur v3 de #44. La seconde
fusion, `origin/main` `78533fe5` (PR #46, trace de la migration 2.6 ; PR #47,
chemins résolus de la boucle dans `dev-loop-state.ts`), ne touche ni le chemin
full ni les workflows ; ses gardes de la boucle sont rejoués par Vitest.

Chiffres CI de référence : la description de la PR qui introduit ces
changements relève, avec les identifiants de run, la suite critical complète à
2 workers et le Quality Gate de cette PR, caches froids (la PR modifie ce
workflow, donc sa sélection est `full`). Les gains à caches chauds (build Army,
instantané de base, tsc et ESLint) ne se mesurent qu'à partir du premier push
sur `main`, qui enregistre ces caches.

### Limites

- Une PR `none` ne lance pas de build Army : un build de production cassé par
  une telle PR n'apparaît qu'au push sur `main` (Build du Quality Gate et suite
  Army complète). Le Quality Gate lance toujours OpenAPI, typecheck, lint et
  tests sur la PR.
- La détection est statique : imports (statiques, `import("...")`, `require`,
  `new URL(..., import.meta.url)`, `@import` CSS) et chaînes `/api/...`. Un module
  chargé par un chemin calculé, ou une route appelée par une URL dont le début
  n'est pas un `/api/<famille>` littéral, n'est pas vu ; la règle des points
  d'entrée, le push sur `main` et la nuit rattrapent le reste.
- Gains mesurés en local seulement à la rédaction (section Mesures) ; le run CI
  de la PR, suite critical complète, fait foi. Aucun job de PR ne lance le full
  non filtré (phase développement comprise) : une PR qui modifie ce chemin le
  prouve par un déclenchement d'`e2e-army-full.yml` sans motif sur sa tête.
- Métré : les règles `takeoff-*` décrivent les pages que chaque parcours ouvre
  (lecture des parcours au 18/10/2026) et surestiment plutôt (par exemple tout
  `src/app/dashboard/orders/**` pour US-4.4). Une page ouverte par un lien
  calculé n'est pas vue ; la nuit la rattrape. Un push sur `main` ne relance pas
  le métré qu'une PR fusionnée a prouvé.
- Un `all` sans liste (carte illisible) lance la sélection full entière dans
  `army-takeoff` (environ 30 min) : coûteux, mais jamais moins de parcours.

## Jobs parallèles

Demande du 18/10/2026 (levier L2, accélérer la CI) : raccourcir la durée murale
des trois workflows TesterArmy sans affaiblir aucune preuve. Les parcours
sélectionnés sont répartis en shards, chacun dans son job, sur sa propre pile
native possédée, avec sa base et son compte ARMY ; un job d'agrégation est le
contrôle et vérifie que les shards ont, ensemble, exécuté exactement la
sélection.

### Point de départ (runs relevés le 18/10/2026)

Durée murale : de la création du run à la fin de son dernier job (API des jobs).

| Workflow | Runs relevés | Durée murale | Chemin critique |
| --- | --- | --- | --- |
| TesterArmy Critical | les 9 runs de la suite complète du 18/10, 09:02 à 10:48 UTC, la période des runs de la PR #52 : 6 push sur `main` (39113776570, 39116902885, 39118649738, 39118677442, 39120614572, 39120664290) et 3 PR (39117364539, 39119401428, 39119642798) | 10 min 22 s à 14 min 33 s, médiane 12 min 30 s | `army-critical` ; sur une PR, `army-takeoff` (4 min 55 s à 6 min 18 s) en parallèle |
| TesterArmy Full | 9 derniers runs non filtrés (38810364369 à 39110052211) ; même période, 39117805338 : 27 min 44 s | 21 min 11 s à 33 min 47 s, médiane 25 min 26 s | un job : phase full puis développement |
| TesterArmy calc-v3 | les 5 runs verts d'avant la PR (39096480257, 39107622162, 39109681565, 39113912045, 39113912980) | 18 min 54 s à 28 min 06 s, médiane 23 min 16 s | un job : six phases en série |

Critical : les 10 runs relevés d'abord (39089874956 à 39109681611, 02:22 à
07:58 UTC, médiane 16 min) ne sont plus comparables, le même job unique ayant
pris 10 à 15 min sur `main` pendant les runs de la PR ; seule la même période
sert de point de départ.

Décomposition, run 39109681611 (PR #42, suite critical complète à 2 workers,
tête `fef02223`) : installation et Chromium 50 s, pile 20 s, `db reset`, pgTAP
et RLS 21 s, build 1 min 43 s, parcours 9 min 44 s (103 tests, 1 130 s
cumulées, soit 1,95 worker occupé en moyenne). Suite full : 1 257 à 1 660 s de
parcours à 1 worker, phase développement 50 à 91 s. calc-v3, run 39109681565 :
`journeys` 205 s, `components` 130 s, `numeric` 150 s, `resume` 104 s,
`access` 78 s, `offers` 474 s (pile, base, build et parcours compris).

### Workers : pas de hausse

- Qualifiés : 2 pour les parcours critical de la pile possédée ; 3 reste
  exploratoire (une seule suite verte, avant la correction de HUB02) ; full,
  métré et calc-v3 à 1 ([qualification](tester-army-local-development.md)).
- Plancher : `e2e/army/local/engine-v3-editor.e2e.ts`, quatre tests d'un même
  fichier, 246 à 302 s. Le scheduler du SDK distribue des unités fichier ×
  cible : un worker de plus ne coupe pas ce fichier, il ajoute seulement de la
  concurrence sur le même compte et le même tenant, sur un runner public de
  4 vCPU que se partagent déjà Next, la pile Supabase et Chromium.
- État partagé : les rapports des runs relevés ont `serialGroups: []`, aucun
  parcours n'a de `beforeAll` ni d'`afterAll`, chaque fichier crée ses propres
  brouillons ARMY et n'écrit que dans le répertoire de preuves de son checkout.
  Aucune dépendance entre fichiers : le fichier est l'unité de partage, et un
  groupe serial du SDK, qui vit dans un fichier, reste entier.
- Le parallélisme ajouté passe donc par les shards : pile, base et compte
  propres à chacun, aucune concurrence nouvelle sur un tenant. Chaque shard
  critical reste à 2 workers, chaque shard full à 1.

### Plan des shards

- `scripts/tester-army/army-shards.json` : secondes mesurées par fichier
  (somme de ses tests, moyenne des runs `measured`), `defaultSeconds` (20) pour
  un fichier non mesuré, et par suite `maxShards`, `secondsPerShard`, `workers`
  (critical : 4, 360 s, 2 ; full : 6, 320 s, 1). Sous `scripts/tester-army/**`,
  tout changement lance la suite critical complète.
- `planShards` (`select-journeys.ts`) : nombre de shards = min(`maxShards`,
  parcours authentifiés, ⌈secondes ÷ `secondsPerShard`⌉) ; le fichier le plus
  long d'abord, vers le shard le moins chargé (égalité : chemin, puis premier
  shard), les parcours authentifiés avant les anonymes, si bien que chaque shard
  a un parcours métier authentifié (le runner refuse sinon) ; le setup de
  connexion dans chaque shard. Même liste, même plan, quel que soit l'ordre.
- Un seul shard, dans deux cas :
  - les secondes mesurées tiennent dans un shard, ou `army-shards.json` est
    illisible ou invalide : une sélection `files` garde alors ses fichiers, la
    suite entière lance la sélection du runner lui-même ;
  - la liste ne peut pas servir de `--files` (repli sûr de la carte, liste vide,
    chemin que le runner refuse, setup absent) : ce shard lance la suite
    entière du runner lui-même, pour une sélection `files` aussi (plus de
    parcours, jamais moins), comme avant les shards.
- Critical (`e2e-army-critical.yml`) : le job `army-select` décide une fois
  (`selection.json`, champ `shards`, sortie `critical_shards`) ; liste = les
  fichiers de la sélection, ou pour `full` la liste `localBusiness` de
  `e2e.config.ts` appliquée à l'arbre de travail (celle que la validation de la
  carte compare). Shards `army-critical shard <n>/<total>` :
  `run-tester-army-ci.ts critical --shard <n>/<total> --files <fichiers>`.
  `army-takeoff` lit les sorties du même job.
- Full (`e2e-army-full.yml`) : `select-journeys.ts --plan full` liste les globs
  de la sélection full de `e2e.config.ts` dans l'arbre de travail (un parcours
  non inscrit dans la carte est listé) ; shards
  `run-tester-army-ci.ts full --shard <n>/<total> --files <fichiers>` à 1 worker ;
  phase développement dans le job `army-full development`
  (`full --phase development`, `next dev`, sans build de production, manifeste
  `scope: full-development`). `--grep` : un shard sans développement ; liste
  impossible : un shard qui lance les deux phases sur sa pile.
- calc-v3 (`e2e-army-calc-v3.yml`) : un job par phase planifiée
  (`CALC_V3_NIGHTLY_PHASES`, ou la phase ou `all` d'un déclenchement).
- Au 18/10/2026 : suite critical complète en 3 shards de 348, 350 et 348 s
  mesurées ; suite full en 5 shards de 306 à 308 s (46 fichiers depuis
  `bulk-actions-v1-totals.e2e.ts`, compté aux 20 s par défaut).

### Contrôle d'agrégation

- Jobs `army-critical`, `army-full` (et son nom filtré inchangé) et
  `army-calc-v3` : les noms de contrôle d'avant, que lisent les outils de suivi.
  Ils dépendent (`needs`) du plan, de la matrice et du job développement, et
  tournent après un échec (`if: ${{ !cancelled() }}`), jamais après une
  annulation ; la matrice n'a pas de `fail-fast`.
- `scripts/tester-army/aggregate-shards.ts` (Node seul) échoue sauf si : chaque
  job attendu a réussi (ou est ignoré quand le plan ne le prévoit pas) ; chaque
  unité prévue a laissé son manifeste (`status` et `privacy` `passed`, `suite`,
  `scope`, `shard`, `workers` et `journeyFiles` conformes au plan) ; chaque
  fichier téléchargé correspond à l'inventaire SHA-256 de ce manifeste et aucun
  n'y manque ; chaque rapport de phase a tous ses résultats sélectionnés
  exécutés et réussis, sans skip, interruption ni écart de compte ; toutes les
  unités ont testé la même révision (`GITHUB_SHA`), le même diff et les mêmes
  entrées ; chaque shard a exécuté exactement ses fichiers, et ensemble
  exactement ceux du plan, aucun deux fois ; pour une sélection `files`, le plan
  couvre exactement la sélection ; pour la suite entière en shards, la liste du
  plan est exactement celle que le CLI e2e a découverte dans chaque shard (le
  `report.json` d'un shard liste tous les tests découverts, ceux hors de ses
  fichiers ignorés avec le motif « file not selected by a positional
  argument »). calc-v3 : chaque phase prévue a sa preuve et
  son `calc-v3.json` vert pour cette phase. Chaque unité est lue sous
  `<chemin>/<artefact>/` ; un artefact unique, que `download-artifact` extrait
  à plat, se lit comme la seule unité prévue, identité contrôlée.
- Preuves : chaque unité garde son artefact et son manifeste
  (`army-critical-shard-<n>-evidence`, `army-full-shard-<n>-evidence`,
  `army-full-development-evidence`, `army-calc-v3-<phase>-evidence`).
  L'artefact d'agrégation, sous le nom d'avant (`army-critical-evidence`,
  `army-full-evidence` ou `army-full-filtered-evidence`,
  `army-calc-v3-evidence`), contient `manifest.json` (schéma
  `army-ci-aggregate-1` : résultats des jobs, plan, chaque unité avec le
  SHA-256 de son manifeste et de ses rapports, union attendue et exécutée,
  problèmes) et une copie de chaque unité sous `units/<artefact>/` ; une
  agrégation en échec les garde aussi.
- Portée : chaque shard garde la sienne (`filtered-critical`, `filtered-full`,
  `full-development`) et `shard: {index, total}` ; l'agrégation porte celle du
  run (`critical` pour la suite complète, `filtered-critical`, `full`,
  `filtered-full`). Seule l'agrégation qualifie une suite.
- `none` : aucun shard ; `army-critical` vert avec une annonce, aucune preuve
  revendiquée.
- Isolation justifiée : `src/test/army-shard-aggregate.test.ts` reproduit les
  échecs qu'un run CI ne produit pas à la demande (shard sans preuve, job rouge,
  ignoré ou annulé, fichier manquant, en trop ou en double, preuve altérée ou
  hors inventaire, révisions mélangées, shard échangé, développement absent,
  `--grep` présenté comme la suite, phase calc-v3 rouge ou d'une autre phase) ;
  `src/test/army-impact-map.test.ts` vérifie le plan (partition exacte, setup et
  parcours authentifié par shard, ordre indifférent, replis) et les sorties de
  matrice ; `src/test/ci-guardrails.test.ts` le câblage des trois workflows et
  le script de plan calc-v3, exécuté.

### Coût et durée murale

Durée murale ≈ plan (environ 20 s) + le shard le plus long + agrégation
(environ 30 s). Un shard coûte un fixe (installation et Chromium environ 50 s,
pile 20 s, base 10 à 30 s, build 1 min 30 à 2 min) plus ses parcours : le fixe
est payé par shard, c'est le prix en minutes de runner (gratuites pour un dépôt
public, mais au plus 20 jobs simultanés pour tout le dépôt).

| Workflow | Avant | Après, estimé | Jobs lourds | Minutes de runner, avant → estimé |
| --- | --- | --- | --- | --- |
| Critical, suite complète | 10 à 15 min | environ 8 min (fixe 3 min 15 + 317 s simulées) | 1 → 3 shards (+ `army-takeoff` sur une PR) | 19 → 25 (`army-takeoff` compris des deux côtés) |
| Full, nuit | 21 à 34 min | environ 10 min (fixe 4 min + 313 s simulées) | 1 → 5 shards + développement | 28 → 52 |
| calc-v3, nuit | 19 à 28 min | environ 9 min (`offers`, 474 s, plus installation) | 1 → 6 phases (8 depuis le 2.7, non mesurées) | 25 → 25 (six phases) |

Simulation (`army-shards.json`, ordre des fichiers du scheduler, 2 workers par
shard critical) : 550 s de parcours en un shard (mesuré 578 s), 404 s en deux,
317 s en trois, 289 s en quatre. Le quatrième shard ne gagnerait que 28 s pour
un job de plus sur les 20 du dépôt : une PR complète en occupe déjà environ
dix (trois shards, `army-takeoff`, Quality Gate, smoke, RLS). Les durées
mesurées en CI après le changement sont relevées ci-dessous.

### Mesures des jobs parallèles

Runs du 18/10/2026 de la PR #52, mesurés par l'API des jobs : durée murale de
la création du run à la fin de son dernier job, minutes de runner en somme des
durées des jobs. Avant : le point de départ ci-dessus (même période pour
critical).

| Workflow | Avant | Tête `cde9f237` | Tête `b54e0988` | Gain mural (`b54e0988`) |
| --- | --- | --- | --- | --- |
| Critical, suite complète (PR) | médiane 12 min 30 s (10 min 22 s à 14 min 33 s, 9 runs) | 7 min 48 s (39118155443) : shards 6 min 08 s à 7 min 17 s, étape des parcours 5 min 09 s à 6 min 18 s | **8 min 08 s** (39121336213) : sélection 10 s ; shards 7 min 33 s, 6 min 43 s et 5 min 07 s ; agrégation 17 s ; `army-takeoff` 5 min 43 s en parallèle | 1,5 fois |
| Full, déclenchement sans motif | médiane 25 min 26 s (21 min 11 s à 33 min 47 s, 9 runs) | 9 min 13 s (39118690328, jusqu'à 1 min 01 s d'attente d'un runner) | **7 min 55 s** (39121895810) : plan 8 s ; shards 6 min 20 s à 7 min 25 s ; développement 3 min 10 s sans build ; agrégation 15 s | 3,2 fois |
| calc-v3 `nightly` (PR) | médiane 23 min 16 s (18 min 54 s à 28 min 06 s, 5 runs) | 10 min 00 s (39118155457) | **9 min 34 s** (39121336221) : `offers` 9 min 12 s, les cinq autres phases 3 min 15 s à 4 min 40 s ; agrégation 12 s | 2 à 2,9 fois (2,4 sur la médiane) |
| Full filtré `--grep` | 4 min 06 s (39089324671) | — | 3 min 26 s (39121897344, non qualifiant) | — |
| calc-v3, une phase (`access`) | — | — | 3 min 26 s (39121899428) | — |

Minutes de runner, sur les mêmes jobs avant et après :

| Workflow | Avant | Après (`b54e0988`) | Rapport |
| --- | --- | --- | --- |
| Critical, PR de suite complète (`army-critical` et `army-takeoff`) | 18 min 23 s à 19 min 03 s (39119401428, 39117364539, 39119642798) | 25 min 33 s (25 min 28 s sur `96513413`, 26 min 27 s sur `cde9f237`) | 1,35 fois |
| Full sans motif | médiane 25 min 26 s (un job) | 38 min 27 s (40 min 15 s sur `cde9f237`) | 1,5 fois |
| calc-v3 `nightly` | 18 min 51 s à 28 min 04 s (un job) | 28 min 54 s (29 min 21 s sur `cde9f237`) | 1 à 1,5 fois |

Sans `army-takeoff`, les shards critical et leur agrégation coûtent 19 min 50 s
contre 10 min 42 s à 13 min 28 s pour le job unique (environ 1,6 fois). Quality
Gate : 2 min 25 s (`cde9f237`), 2 min 09 s (`b54e0988`). Aucun job de
`b54e0988` n'a attendu un runner plus de 3 s.

Agrégations de `cde9f237`, toutes vertes : critical, 28 fichiers prévus, exécutés et
découverts par le CLI dans chaque shard (103 tests découverts ; 18, 60 et 27
résultats sélectionnés, setup compris), aucun manquant, en trop ni en double,
artefact `army-critical-evidence` ; full, 45 fichiers prévus et exécutés
(164 tests découverts par shard ; 13, 35, 34, 32 et 54 sélectionnés) et la
phase développement (4/4, `scope: full-development`), artefact
`army-full-evidence` ; calc-v3, six phases vertes, artefact
`army-calc-v3-evidence`. Le contrôle de découverte du CLI, ajouté ensuite à
l'agrégation, a été rejoué en local sur les preuves téléchargées des runs
39118155443 et 39118690328 : vert (28 et 45 fichiers découverts, égaux au
plan).

Tête `96513413` (ce contrôle, plus la fusion d'`origin/main` `d4b6ff73`) :
critical 7 min 56 s (39119649612, shards 6 min 39 s à 6 min 56 s, vert) ;
calc-v3 10 min 42 s (39119649587, `offers` 10 min 05 s, vert) ; full 8 min 26 s
(39120185323) **rouge** : V3E01 (`e2e/army/local/engine-v3-editor.e2e.ts`)
échoue dans le shard 1/5, la sauvegarde observée ne rejoint pas l'oracle avant
l'échéance (`fixtures.ts:355`, preuve `save-observed-9df79726…` de l'artefact
`army-full-shard-1-evidence`, `predicateMatched: false`, HT 5 554,61 €) ; le
même parcours passe dans le shard critical 1/3 de la même arborescence et sur
`main` (39118858643), et dans le shard full 1/5 de `cde9f237`. L'agrégation est
rouge comme attendu. Parcours intermittent signalé à son lot, non corrigé ici.
Le déclenchement filtré par `--grep` (39120187109, 3 min 33 s) a révélé un
défaut de l'agrégation : `actions/download-artifact` extrait le seul artefact
qu'un motif retient directement dans son chemin, sans sous-dossier, et le shard
unique paraissait sans preuve. Corrigé : un téléchargement à plat se lit comme
l'unité unique prévue, dont l'identité (shard, phase, portée) est contrôlée
comme les autres ; à plat face à plusieurs unités, l'agrégation échoue. Ce cas
touche chaque sélection critical d'un seul shard (petites PR) et chaque phase
calc-v3 déclenchée seule ; rejoué en local sur les preuves du run 39120187109 :
vert, `scope: filtered-full`.

Tête `b54e0988` (ce correctif, plus la fusion d'`origin/main` `d7e672b4`, PR #41
et #53) : agrégations vertes, critical 28/28 fichiers prévus, exécutés et
découverts par le CLI dans chaque shard ; full 46/46 (dont
`bulk-actions-v1-totals.e2e.ts`, ajouté par `main` entre-temps et listé sans
modification du plan) plus le développement 4/4 ; calc-v3 6/6 phases ; aucun
manquant, en trop ni en double. Le déclenchement `--grep` (39121897344) et la
phase `access` seule (39121899428) passent par le téléchargement à plat : verts.
V3E01 est vert dans les shards critical et full après #53
(`fix/v3e01-labour-role-lost`) : run d'une nouvelle tête, pas une relance du
rouge.

Écarts au modèle : l'étape des parcours d'un shard critical (4 min 21 s à
6 min 36 s) dépasse les 317 s simulées, et la phase `offers` (8 min 41 s d'étape
sur `cde9f237`) les 474 s mesurées dans l'ancien job, où son build reprenait le
cache webpack des phases précédentes ; le shard le plus long reste le chemin
critique. Le gain mural va de 1,5 fois (critical) à 3,2 fois (full), 2 à
2,9 fois pour calc-v3 ; il se paie en minutes de runner : 1,35 fois pour
critical (mêmes jobs, `army-takeoff` compris), 1,5 fois pour full, 1 à 1,5 fois
pour calc-v3.

### Chemins d'échec de l'agrégation, prouvés en CI

Le 18/10/2026, une branche jetable (`throwaway/l2-aggregate-failure-proof`,
commit `fc01e2ce` sur `1d934f35`, jamais fusionnée, supprimée après ses runs) a
injecté des fautes dans les jobs d'unité, sans toucher `aggregate-shards.ts` ni
les jobs d'agrégation, puis déclenché les trois workflows :

| Run | Fautes injectées | Jobs d'unité | Agrégation |
| --- | --- | --- | --- |
| Full 39125133203 (8 min 20 s) | (1) `prehydration-auth.e2e.ts` lève une erreur pour `signup` (shard 1/5) ; (2) le shard 2/5 retire son dernier fichier prévu, `takeoff-dpgf-review.e2e.ts`, et passe ; (3) après son manifeste, le shard 3/5 ajoute un saut de ligne à `full/report.json` et un fichier `planted.txt` ; (4) le shard 4/5 passe sans téléverser ses preuves ; (5) le job développement est ignoré (`if: false`) ; le shard 5/5 est intact | shard 1/5 rouge ; 2/5 à 5/5 verts ; développement ignoré | **rouge**, 13 problèmes, un ou plusieurs par faute : matrice `failure` et développement `skipped` au lieu de `success` ; shard 1/5 `status failed` et son résultat rouge ; shard 2/5 `journeyFiles` hors plan et `did not run …takeoff-dpgf-review.e2e.ts` ; shard 3/5 `full/report.json does not match its inventory` et `planted.txt is not in its inventory` ; shard 4/5 et développement sans manifeste ; 11 fichiers prévus absents de l'union. Aucun pour le shard 5/5 |
| Critical 39125135446 (8 min 26 s) | (1), qui tombe dans le shard 3/3 ; `army-takeoff`, que l'agrégation n'attend pas, ignoré pour économiser des minutes | shard 3/3 rouge ; 1/3 et 2/3 verts | **rouge**, 5 problèmes : matrice `failure`, puis statut, phase, résultat et comptes du shard 3/3 ; union 28/28 ; aucun pour les shards 1/3 et 2/3 |
| calc-v3 `access` 39125137105 (3 min 50 s) | (6) le job `access` lance la phase `resume` et la téléverse sous `army-calc-v3-access-evidence`, lue à plat | tous verts | **rouge**, 3 problèmes : portée `calc-v3-resume` au lieu de `calc-v3-access`, phase `resume` enregistrée, `calc-v3.json` a lancé `resume` |

Des jobs d'unité verts ne suffisent donc pas : les shards full 2/5 à 4/5 et le
job `access` étaient verts, et l'agrégation a lu leurs preuves. Chaque
agrégation rouge a gardé son artefact (`army-full-evidence`,
`army-critical-evidence`, `army-calc-v3-evidence`, rétention 7 jours) avec
`status: failed`, la révision `fc01e2ce` et ses problèmes. L'annulation est
observée sur la PR : runs 39119464374 et 39119464339, agrégation `cancelled`,
jamais verte. Non observés en CI : une sélection `none` et une PR critical d'un
seul shard, couvertes par `src/test/army-shard-aggregate.test.ts` et, pour la
lecture à plat, par les déclenchements verts 39121897344 et 39121899428.

### Limites

- Les secondes dérivent avec les parcours : un fichier qui s'allonge
  déséquilibre les shards (durée murale, jamais couverture). Les remettre à
  jour depuis les `report.json` d'un run récent (somme des tests par fichier).
- La liste de la suite entière est la lecture des globs d'`e2e.config.ts` par
  `globToRegExp`, celle qui valide déjà la carte. Un parcours que le CLI
  trouverait en dehors de cette lecture n'est pas lancé, mais l'agrégation le
  voit dans la découverte de chaque shard et échoue : le défaut se voit au run,
  pas avant.
- Relancer un seul shard rouge relance aussi l'agrégation, qui relit les
  preuves de tous les shards du run.
- Aucun contrôle requis par la protection de branche (le ruleset
  `main-protection` n'interdit que la suppression) : les noms stables servent
  les outils de suivi et la lecture des PR.

## Campagne calc-v3 nocturne (`e2e-army-calc-v3.yml`)

Demande du 18/10/2026 : la campagne du lot 2 (`npm run e2e:army:calc-v3`,
[contrat et phases](tester-army-calc-v3.md)) n'était lancée par aucune CI, et
les agents la rejouaient en local (6 à 7 min). Elle tourne désormais chaque nuit
à 04:45 UTC, après la suite full, sur `ubuntu-24.04`, avec les mêmes gardes que
`e2e-army-full.yml` : garde de cible, aucun secret, installation sans `env`,
pile native possédée et détruite, cache webpack du build restauré seulement,
pas d'instantané de base (`db reset` complet), 1 worker, preuves
`army-calc-v3-evidence` téléversées seulement après le contrôle de
confidentialité du runner.

- Sélection nocturne : les phases servies par le build de production, toutes
  depuis le sous-lot 2.7 (`journeys`, `components`, `numeric`, `resume`,
  `access`, `offers`, `emission`, `emission-v3`), une
  invocation `run-tester-army-ci.ts calc-v3 --phase <phase>` par phase, chacune
  sur sa propre pile et dans son propre job (`army-calc-v3 <phase>`, matrice
  sans `fail-fast`) ; une phase rouge n'arrête pas les autres, et le job
  `army-calc-v3` échoue en nommant les phases sans preuve
  ([jobs parallèles](#jobs-parallèles)). Le répertoire de preuves de chaque
  phase n'est téléversé (`army-calc-v3-<phase>-evidence`) que si le runner l'a
  publié (sortie `evidence`, écrite seulement après le contrôle de
  confidentialité) ; `army-calc-v3-evidence` les réunit avec le manifeste
  d'agrégation.
- Émission dans la nuit depuis le sous-lot 2.7 : jusque-là servie par
  `next dev` (`canUseDevelopmentEstimateTerms` n'acceptait les conditions bac à
  sable qu'en développement), où OF00 échouait 7/7 depuis la PR #34
  (rechargement à chaud qui remonte l'éditeur ; 6/6 en production avec un garde
  local), elle restait hors de la nuit. Le 2.7 (PR #45) étend ce garde au profil
  de production possédé, sert `emission` et la nouvelle phase `emission-v3` en
  production, et les ajoute à `CALC_V3_NIGHTLY_PHASES` et aux options de
  `phase`, rien d'autre. Le garde `src/test/ci-guardrails.test.ts` exige que
  cette liste soit exactement l'ensemble des phases dont `serverMode` vaut
  `production` (`scripts/tester-army/calc-v3-phases.ts`) et que les options
  soient `nightly`, `all` puis chaque phase : une phase ajoutée ou basculée sans
  le workflow fait échouer le Quality Gate. La PR #45, qui modifie ce workflow,
  lance elle-même la sélection nocturne, émission comprise (ci-dessous).
- Déclenchement manuel (`workflow_dispatch`, entrée `phase`) : `nightly`
  (défaut, la sélection ci-dessus), `all` (la campagne complète en une
  invocation, émission comprise, exactement `npm run e2e:army:calc-v3`) ou une
  seule phase, `emission` et `emission-v3` comprises. Le nom passe par `env`,
  et le runner refuse toute valeur qui n'est pas une phase. GitHub ne planifie
  et ne déclenche que les workflows présents sur la branche par défaut : ni la
  nuit ni le déclenchement manuel n'existent avant la fusion de ce workflow sur
  `main` ; ensuite, un déclenchement sur une branche exécute la version de cette
  branche.
- Pull request : une PR vers `main` qui modifie
  `.github/workflows/e2e-army-calc-v3.yml` lance la sélection nocturne (filtre
  `paths`), si bien que le workflow est prouvé avant sa fusion ; aucune autre PR
  ne le lance. Un nouveau push sur la PR annule et remplace son run en cours ;
  un run nocturne ou déclenché n'est jamais annulé (groupe de concurrence par
  run).
- Coût : une pile et un build par phase, chacun dans son job sur le cache
  webpack restauré depuis `main` ; délai maximal d'un job de phase 80 min.
  Avant les jobs parallèles, mesuré sur la PR #42 pour les six phases d'alors
  (un seul job, phases en série) : 28 min 04 s (run 39096480257, tête
  `964775bc`, six phases vertes), 28 min 30 s (run 39089316912, tête
  `9467ba95`, `resume` rouge), 25 min 01 s (run 39107622162) et 19 min 55 s
  (run 39109681565, tête `fef02223`). Durée murale et coût en runner après :
  section [Jobs parallèles](#jobs-parallèles). Depuis le 2.7, la sélection
  compte huit phases (`emission` et `emission-v3` en plus), soit huit piles et
  huit builds par nuit : ce coût n'est pas encore mesuré (premier run : celui de
  la PR #45), pas plus que la nuit, qui n'existe qu'après la fusion sur `main`.

## Contrat défini avant migration

Les anciens workflows Playwright critical/nightly sont remplacés par TesterArmy
critical/full. Leur garde de cible ajouté par l'audit du 14 octobre est conservé,
avec une origine de boucle locale constante. Aucun secret d'environnement partagé
n'est chargé. La base réelle est créée par le runtime Supabase natif isolé :
projet temporaire, ports propres au run, migrations du checkout, pgTAP, matrice RLS,
puis parcours métier. La destruction de cette seule pile reste dans `finally`.

Défaillances à exposer avant implémentation :

1. Une variable Supabase/DB préconfigurée, une cible distante ou un hôte natif
   incompatible doit échouer avant création de la pile ; les protections existantes
   de `local-supabase-ci` restent effectives.
2. Le navigateur ne doit commencer qu'après le passage effectif de pgTAP et RLS.
   Le hook applicatif doit recevoir uniquement la configuration locale générée et
   être attendu avant arrêt de la pile.
3. Un échec applicatif ne doit ni être déclaré réussi ni empêcher `stop`,
   `stack destroy` et le retrait du répertoire temporaire possédé.
4. Un code retour zéro avec une suite vide, ignorée ou incomplète n'est pas une
   preuve : le rapport Army doit avoir des tests métier sélectionnés et exécutés,
   tous réussis, aucun skip/interruption et aucune erreur globale.
5. Le bootstrap ne doit pas réutiliser de compte réel : compte aléatoire local,
   tenant personnel vérifié, article catalogue ARMY dédié et connexion UI normale.
   Les clés et mots de passe ne sont ni inscrits dans un fichier env ni publiés.
6. Une erreur de préparation conserve un manifeste d'échec. Les archives publiques
   de CI excluent les sessions navigateur et ne sont publiées qu'après contrôle
   de confidentialité des preuves conservées.
7. Le profil full doit exécuter les parcours de production puis les trois
   parcours du simulateur exclusivement disponible en développement. Les deux
   phases utilisent la même pile éphémère, conservent chacune leur rapport avant
   remplacement des sorties courantes et doivent toutes deux réussir. Un succès
   production seul ne qualifie pas le profil full. L'identité du build est
   vérifiée en production ; les sources restent figées dans les deux phases.
   Depuis les [jobs parallèles](#jobs-parallèles) (18/10/2026), la nuit lance
   les deux phases sur des piles distinctes (shards de la phase full,
   `full --phase development`) ; c'est le job `army-full` qui exige alors que
   toutes réussissent, et un `run-tester-army-ci.ts full` sans option garde ce
   contrat sur une seule pile.

Défaillance d'agrégation relevée avant correction : le premier rejet de la
phase production interrompait le hook et supprimait la pile avant les trois
parcours de développement. Le profil full doit désormais conserver le rapport
de production échoué, tenter la phase développement indépendante, puis retourner
un échec global si au moins une phase échoue. Chaque résultat reste distinct ;
une impossibilité de conserver la première preuve bloque la phase suivante pour
éviter son écrasement. La recette full réelle avec une phase rouge expose ce
défaut ; aucun nouveau test unitaire d'orchestration n'est ajouté après le code.
La revue précise deux refus nécessaires avant cette deuxième phase : manifeste
absent/périmé et archive de préparation non conservée. La copie CI doit inclure
l'archive exacte référencée par le manifeste courant (journaux compris), après
vérification de son confinement et de son empreinte. Un ancien rapport SDK ne
doit pas être repris comme preuve d'un échec de préparation actuel.

Les deux scénarios lifecycle existants sont adaptés avant le hook pour exposer
l'ordre/attente et la destruction après rejet. Cette isolation est justifiée par
les pannes de processus et de nettoyage qu'une recette navigateur ne peut pas
injecter sûrement. Aucun test unitaire miroir du YAML n'est ajouté ; les gardes
CI existants et la recette réelle constituent les autres preuves.

Une exécution locale de ce bootstrap qualifie le cycle sur son hôte. Elle ne
prouve pas un job GitHub exécuté sur la révision publiée ; cette preuve reste
distincte et doit être relevée après publication.

## Blocage découvert pendant le vrai bootstrap

Le rejeu SQL sur un checkout HEAD propre a échoué avant création de la pile : le
CLI épinglé 2.120.0 ajoute désormais une notification de disponibilité 2.121.0
sur stderr. Le wrapper existant concatène les deux flux, et la comparaison de
toute cette sortie à `2.120.0` refuse donc un binaire pourtant conforme. Le log
`.codex-tmp/army-ci-migration-20261015/linux-db-only.log` conserve le refus.
La régression lifecycle existante reçoit cette sortie réelle avant correction.
Lire la première ligne exacte conserve la vérification de version ; le manifeste
du package et celui du binaire restent également épinglés. Une version différente
doit toujours échouer avant préparation du projet.

Le second rejeu atteint pgTAP mais échoue sur quatre suites HEAD : gouvernance
du calcul (assertions 78–81), fixture outbox sans contrat client, ancienne
signature de décision portail dans deux suites. Le log
`.codex-tmp/army-ci-migration-20261015/linux-db-only-after.log` rapporte 13
fichiers et 1142 assertions, avec résultat FAIL. La pile temporaire est retirée
malgré cet échec ; aucun parcours navigateur n'a encore été exécuté par ce run.

Les corrections de ces suites restent dans des blobs séparés, à partir de HEAD,
sous `.codex-tmp/army-migration-20261015/overrides/supabase/tests/database/`.
Les fichiers utilisateur correspondants dans le checkout restent inchangés.
Les défaillances à couvrir sont la publication d'un document sans contrat, la
préparation/envoi sans preuve du document publié, l'appel d'une ancienne
surcharge sans preuve et la suppression d'une capacité d'offre immuable. Les
fixtures doivent passer par les RPC de publication et d'émission actuelles ;
seules les lignes historiques qui précèdent ces gardes peuvent être préparées
comme telles. Les assertions existantes d'idempotence, immutabilité, permissions,
montants et reprises restent exécutées. L'isolation SQL est nécessaire pour les
privileges, signatures et états historiques impossibles à créer normalement
depuis le navigateur actuel ; tout le périmètre pgTAP est conservé.

Le rejeu corrigé passe les 1250 assertions pgTAP puis révèle une fixture RLS
ancienne : insertion directe d'un jeton portail refusée avec
`OFFER_CAPABILITY_DISPATCH_REQUIRED`. La recette RLS existante doit créer son
offre via réservation, publication du contrat, préparation et achèvement
local du dispatch, sans appel de fournisseur mail. Elle doit refuser la décision
sur tenant inactif sans mutation partielle, puis accepter la même preuve après
réactivation : ce contrôle positif évite un refus causé par une fixture invalide.
Cette matrice ne tourne que dans la pile éphémère déjà imposée par son runner.

## Preuves locales du 15 octobre 2026

- Cycle natif SQL/RLS : **13 suites / 1250 assertions pgTAP**, puis **2/2
  parcours RLS**, code retour 0 sur Ubuntu 24.04 dans WSL, Node 24.19.0 et
  Supabase CLI natif 2.120.0. Sources : HEAD `50f19773` avec les quatre overrides
  SQL et les adaptations lifecycle/RLS. Commande, empreintes et retrait du
  répertoire temporaire sont dans
  `.codex-tmp/army-ci-migration-20261015/database-proof.json` ; sortie complète :
  `linux-db-rls-overrides.log` dans le même dossier.
- Les deux refus lifecycle ont été observés avant le hook (2 échecs sur 9),
  puis le cas de bannière du CLI avant son correctif (1 échec sur 9). La suite
  existante termine à **9/9** dans `lifecycle-final.log` ; les sorties rouges
  sont `lifecycle-red.log` et `cli-banner-red.log` dans ce même dossier.
- Le bootstrap refuse une variable Supabase distante préconfigurée avant toute
  phase : code retour 1, liste des étapes vide, manifeste d'échec expurgé.
  Preuve : `.e2e/army/ci/2026-10-15T17-22-56-456Z-critical/manifest.json`.
- Les deux YAML sont lisibles par `js-yaml` et leurs scripts passent `bash -n`.
  ESLint passe sur les quatre fichiers TypeScript touchés (`lint-final.log`).

Ces preuves SQL/RLS et de configuration ne qualifient pas encore les parcours
navigateur du nouveau bootstrap ni un job GitHub publié.

Le premier bootstrap navigateur sur le candidat figé `candidate-1` exécute
55 parcours : 48 réussis, 7 échoués (UX29, HUB05, HUB06–10), aucun ignoré. La
garde d'upload refuse ses preuves parce que les sept `screen-at-failure.txt`
du SDK conservent l'adresse du compte local dans l'état accessible de la page.
Le rapport et les pages de trace étaient déjà expurgés, mais ces fichiers texte
ne l'étaient pas. Les originaux restent privés dans la copie Linux. Avant
correction, le contrôle d'archive existant doit reproduire ce fichier avec des
identifiants synthétiques, vérifier leur absence dans la copie publiée et
vérifier que ses empreintes couvrent les octets expurgés. Cette isolation vise
la confidentialité du système de preuves, distincte des assertions métier
déjà exécutées dans le navigateur ; aucun nouveau test unitaire n'est ajouté.
Le périmètre inclut aussi les textes/JSON métier possédés : une réponse de
préparation PDF peut contenir une URL de téléchargement signée. Le contrôle
existant doit injecter une telle URL et vérifier la suppression de son jeton,
tout en conservant une valeur métier de 101 centimes et les empreintes finales.

Le contrôle d'archive Linux reproduit d'abord ces deux fuites (10 cas réussis,
2 échoués), puis passe ses 12 cas après correction. L'ajout du journal réseau
serveur est aussi couvert : le reçu `guard-installed`, l'expurgation et les
empreintes des octets archivés sont vérifiés. Dernier reçu local :
`.codex-tmp/army-ci-migration-20261015/snapshot-redaction-receipts/worker-log-green.json`,
SHA-256 `89b4358dcac5f90f4d19fb98473cf091128605b8cf47c9a5141702335217fdfe`.
Ce contrôle exerce le wrapper, ses processus et fichiers ; il ne constitue pas
un parcours navigateur. Les images et PDF restent hors expurgation textuelle.

Le candidat 4 Linux exécute 120 parcours : 80 réussis, 40 échoués, aucun ignoré,
interrompu ou flaky ; pgTAP, RLS et build passent. Sources et build restent
inchangés, contrôle de confidentialité réussi. Preuves :
`.codex-tmp/army-ci-migration-20261015/candidate-4-evidence` et
`candidate-4-failures.json` dans le même dossier. La phase développement n'a
pas été exécutée par l'ancienne agrégation de ce candidat.

Avant correction des ports DPGF/Team B : la revue expose maintenant un onglet
Validation sélectionné, la provenance contient aussi son nom de fichier et le
SDK sélectionne une option par libellé sauf `{ value }` explicite. La reprise
nécessite un devis contenant une ligne pour sortir de l'accueil vide. Le CSV
fournisseur lit ses références RLS directement : seule cette recette doit
autoriser les deux lectures locales fournisseurs/produits après preuve de
propriété du projet ; les écritures et hôtes externes restent refusés.

US22 ne souffre pas d'un libellé périmé : la réponse PDF est HTTP500. Le chunk
de production conserve `function(a=createRequire)` sans liaison `createRequire`.
Le contrat est de résoudre PDF.js depuis le module Node natif à l'exécution,
sans toucher la configuration Next ni le worker terminable, ses limites ou son
URL fichier. La recette US22 réelle est rouge avant correction ; l'isolation
existante vérifie l'URL et le worker, mais ne reproduit pas la compilation Next.
La suggestion de prix présente aussi une vraie erreur de schéma, à distinguer
des sélecteurs : la recette doit garder une ligne historique à quantité zéro
et demander une suggestion sur une autre ligne positive sans perdre les trois
sources, la décision humaine et le prix effectivement appliqué.
# Transport SQL des fixtures générées

Avant extension : les cas GEN échouent parce que leurs écritures par REST ne
respectent pas le contrat SQL de génération. Les fixtures doivent utiliser le
client PostgreSQL déjà fourni par le runtime natif, uniquement côté Node.
Échecs à empêcher : URL distante ou différente du statut de la pile possédée,
secret transmis au build, au serveur Next ou au JavaScript de page, client absent ou ambigu,
secret présent dans un log d'erreur, accès à un projet hors fixture ARMY.
Le test de cycle existant doit exiger le DB_URL local dans le hook applicatif
et son absence dans l'environnement RLS. Le test de statut existant doit refuser
les URLs PostgreSQL distantes, mal formées et les paramètres de routage.
L'identité utilisateur/tenant/projet est ensuite revérifiée par la fixture SQL
avant écriture. Army GEN reste la validation réelle de ce transport.

La suite de cycle existante passe 9/9 après deux échecs attendus avant le
changement (`gen-transport-{red,green}.log` dans le dossier de preuve local
`.codex-tmp/army-ci-migration-20261015`). Le client psql est résolu dans le cache
de binaires PostgreSQL du runtime natif ; l'absence ou l'ambiguïté arrête la
recette. Les coordonnées sont fournies au processus Node de recette après le
build et restent absentes de la liste `inheritEnv` du serveur et du JavaScript
de page. Les preuves sont expurgées avant archivage. Le SDK peut transmettre
l'environnement du worker au processus Chromium : aucune isolation de ces
variables dans l'environnement système du navigateur n'est garantie.

## Campagne Linux candidate 6

La projection immuable `cd7f0c540c31d9cf96df69916b1f8a812124345d` a exécuté les
1250 assertions SQL, les deux scénarios RLS et le build. Production : 121 cas
sélectionnés et exécutés, 98 réussis et 23 échoués ; aucun skip, flaky ou
interrompu. La phase development s'est ensuite exécutée sur la même pile :
4/4 réussis. Le résultat agrégé reste en échec. Les sources sont restées stables
dans les deux phases et le build production est resté stable.

Les preuves expurgées sont conservées dans
`.codex-tmp/army-ci-migration-20261015/candidate-6-evidence/{full,development}`.
Le reçu `candidate-6-proof.json` vérifie 1134 fichiers de l'archive supérieure
et les 552/7 artifacts SDK des phases, sans divergence SHA. La pile temporaire
`miaouffrage-supabase-ci-bjrelY` a été supprimée par le nettoyage possédé. Les
échecs restent visibles dans chaque rapport ; cette campagne ne qualifie pas
les corrections réalisées ensuite dans le checkout.

## Campagne Linux candidate 9

Projection `6b315285c401140723c6c2f563ab5bde8d21aead`, 87 chemins vérifiés,
Node 24.19.0, Army 0.21.0 et web 0.15.0. SQL : 13 fichiers / 1253 assertions ;
RLS : 2/2 ; build production réussi. Production Army : 122 cas sélectionnés et
exécutés, 115 réussis et 7 échoués, aucun skip/flaky/interrompu. Development a
ensuite exécuté ses 4 cas avec succès sur la même pile. Le résultat agrégé
reste en échec.

Les cinq cas d'application TKF01/TKF02/TKF06 passent après la migration
safeupdate. Le PDF US-2.2 et les cinq cas DPGF review passent. Les trois
préparations GEN réussissent leurs insertions locales puis leur relecture RLS ;
leur navigation échoue ensuite sur le bouton `Insérer` absent. Les quatre autres
échecs sont AUTH01 (lecture interdite d'un champ secret par le SDK), pilotage
achats (`Brouillons proposés` absent), US-4.4 (`Outils` absent) et US-6.2
(`V2 En attente provider` absent). Aucun de ces échecs n'est reclassé en succès.

Preuves expurgées :
`.codex-tmp/army-ci-migration-20261015/candidate-9-evidence/{full,development}`.
Le reçu `candidate-9-proof.json` vérifie 1134 fichiers de l'archive supérieure
et 552/7 artifacts SDK, sans divergence SHA. Source stable dans les deux phases,
build production stable, contrôle de confidentialité passé. Le nettoyage de la
pile temporaire `miaouffrage-supabase-ci-2h0iWL` est confirmé ; les preuves et le
cache du runtime restent conservés.

## Campagne Linux candidate 12

Projection immuable `9eb58c553a886202f7da7e661618189373ca1fca`, 141 chemins
vérifiés. SQL : 1253 assertions ; RLS : 2/2 ; build réussi. Production :
122 cas sélectionnés et exécutés, 119 réussis et 3 échoués (GEN fallback,
GEN provenance et US-4.4), aucun skip/flaky/interrompu. Development : 4/4
sur la même pile ; le résultat agrégé reste en échec. Les guardrails existants
ont aussi passé leurs 8 cas sous Linux, sans skip.

Preuves expurgées :
`.codex-tmp/army-ci-migration-20261015/candidate-12-evidence/{full,development}`.
Le reçu `candidate-12-proof.json` vérifie 1128 fichiers de l'archive supérieure
et 549/7 artifacts SDK, sans divergence SHA. Son SHA-256 est
`c0be3d2a3ad522b1efbce87995106be6241e944bbeffbcd9d96475b9e4c452d6`.
Sources et build production stables, contrôle de confidentialité passé ;
la pile temporaire `miaouffrage-supabase-ci-eZdAhv` est absente après nettoyage.
Les originaux privés et le cache du runtime restent conservés. Cette campagne
ne qualifie pas les corrections de fixtures et de navigation préparées ensuite.

## Échec intermittent du provisionnement ARMY (17 octobre 2026)

Symptôme : environ 2 s après « Behavioral RLS matrix passed. », le job affichait
seulement `TesterArmy CI failed` et le manifeste
`Phase failed: run application validation`, étapes vides (run 39038501242,
tentative 1, PR #28 ; run TesterArmy Full 39034514643, tentative 1). La relance
du même commit passait. `createPhaseError` ne publie le message que pour les
phases de `SAFE_DIAGNOSTIC_PHASES` : les messages du runner restaient masqués.

Défaillances à exposer avant correction :

1. Un échec du provisionnement doit nommer son étape (`create account`,
   `verify personal tenant`, `verify owned tenant`, `create labor basis`,
   `verify labor basis`, `create catalogue article`) dans le manifeste et le
   journal du job, avec des identifiants non secrets : nom d'erreur, statut
   HTTP, code machine et cause réseau. Les messages, `details` et `hint` ne sont
   jamais lus : ils peuvent citer l'adresse du compte, une ligne ou une URL.
2. Une erreur applicative quelconque reste masquée dans le message de phase ;
   seule une `SafeDiagnosticError`, construite à partir de ces identifiants, le
   traverse. Le motif publié passe le même contrôle de confidentialité que les
   preuves téléversées, sinon il est retenu.
3. Le premier appel Supabase du hook ne doit pas échouer parce que le runner a
   gardé une connexion keep-alive fermée par la passerelle pendant la matrice RLS.

Cause racine : la passerelle du runtime natif annonce `Keep-Alive: timeout=5` et
ferme une connexion inactive après 6 s. Le runner crée les trois comptes RLS sur
une connexion du pool undici, puis lançait la matrice RLS par `spawnSync` : la
boucle d'événements restait bloquée, donc ni le délai d'inactivité d'undici ni
la fermeture du serveur n'étaient traités. Quand l'enfant durait plus de 6 s,
le `createUser` du hook partait sur la connexion fermée :
`AuthRetryableFetchError status=0`, cause `SocketError UND_ERR_SOCKET`
(`other side closed`). Ni la disponibilité d'Auth ni le trigger
`handle_new_user` (synchrone, même transaction) ne sont en cause.

Preuves (WSL Ubuntu 24.04, Node 24.14.0, CLI 2.120.0 ; révision `c2e1c91f`
plus ce changement, puis ce changement rebasé sur `ef30a83d`) :

- CI : sur 32 tentatives critical/full récentes, les deux seuls échecs de
  provisionnement sont les deux segments pgTAP → RLS les plus longs (7,9 s et
  8,7 s) ; toutes les tentatives jusqu'à 7,5 s atteignent le build.
- Passerelle réelle, trois `createUser` puis blocage de la boucle : 39/39 échecs
  `UND_ERR_SOCKET` pour un blocage de 6 à 9 s, aucun en dessous de 6 s.
- Séquence CI complète réelle (pile, reset, pgTAP, comptes RLS, matrice RLS
  enfant, puis appels du runner) sous charge CPU (pgTAP → RLS 10,8 à 12,3 s) :
  module `main` 4/4 échecs à `create account`, module corrigé 0/6 puis 0/3
  après rebase. Sans charge (4,3 à 5,5 s), 0/19 échec : l'enfant reste sous le
  seuil de 6 s.
- Échec réel forcé dans une copie jetable du nouveau runner : le journal affiche
  `TesterArmy CI error: Phase failed: run application validation: Could not create the local ARMY account. [step create account: AuthRetryableFetchError status=0; network TypeError cause=SocketError:UND_ERR_SOCKET]`,
  le manifeste porte `provisioning.failed`, aucune adresse, clé ni URL de base
  dans les preuves, contrôle de confidentialité passé.
- Recette réelle avec la correction,
  `npm run e2e:army:local -- --grep "commercial rounding" --app-port 3127` :
  pgTAP 15 fichiers / 1328 assertions, RLS 2/2, six étapes de provisionnement
  dans `provisioning.completed`, build, 3/3 cas sélectionnés réussis,
  confidentialité passée ; même résultat après rebase.

Correction : la matrice RLS s'exécute par `runChildProcess`, asynchrone, avec la
même limite de sortie de 10 Mio. Aucune relance n'est ajoutée : la défaillance
est déterministe dès que l'enfant dépasse la fermeture de la passerelle, et
relancer un `createUser` non idempotent masquerait cette cause. Le test de cycle
existant reproduit l'échec sans Supabase (serveur HTTP keep-alive local, trois
requêtes, enfant de 3,5 s) : rouge `ECONNRESET` avec l'exécution synchrone, vert
avec l'exécution asynchrone. Cette isolation est justifiée par une course que
la CI ne déclenche qu'avec un runner lent. Les scripts de sonde et leurs sorties
sont conservés dans `.codex-tmp/army-provision-flake-20261017/`.
