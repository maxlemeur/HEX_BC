# TesterArmy métier sur une base CI éphémère

## Sélection par impact des parcours critical

Décision du 17/10/2026 : une pull request ne lance que les parcours TesterArmy
critical que ses fichiers atteignent. La suite critical complète tourne à chaque
push de code sur `main` et chaque nuit.

| Événement | Parcours critical | Build Army |
| --- | --- | --- |
| Pull request, documentation seule ou chemins hors suite | aucun (`none`) | non |
| Pull request, autres chemins | fichiers sélectionnés (`files`) ou suite complète (`full`) | oui |
| Push sur `main` | suite complète, sauf push de documentation seule (aucun) | oui, sauf documentation |
| `workflow_dispatch`, label `army-full` | suite complète | oui |
| Nuit, 03:15 UTC (`e2e-army-full.yml`) | phase `full` : tous les parcours critical, plus extended et takeoff, puis phase développement | oui |

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
setup s'exécute. L'artefact `army-critical-selection` (`selection.json` :
événement, révisions, SHA-256 de la carte, décision par chemin) et le résumé de
l'étape gardent le motif, y compris pour `none`. Une exécution filtrée ne prouve
que ses fichiers ; elle ne qualifie pas la suite complète.

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
déplace `E2E_ARMY_WORKERS` ou l'enregistrement du cache. Sans protection de
branche (plan Free), un Quality Gate rouge n'empêche pas une fusion : le
contrôle de complétude des parcours est donc aussi fait par le sélecteur à
chaque exécution (repli sûr ci-dessus).

À l'ajout d'un parcours critical : l'inscrire dans `suite.journeys` et dans une
règle ou un groupe ; sinon chaque exécution du sélecteur lance la suite
complète. D'une page ou d'une route : la couvrir par une règle, sinon
tout changement qui l'atteint lance la suite complète. D'une route API sans
appelant UI : `api-without-ui-caller`. D'une fixture lue par chemin : une règle
vers ses parcours. Voir la sélection d'une branche :

```sh
node scripts/tester-army/select-journeys.ts --event pull_request --base origin/main --head HEAD
```

### Caches et parallélisme

- Cache webpack du build Army `.e2e/army/next/cache`, hors empreinte du build
  (`build-local.mjs`) : restauré à chaque run critical et full depuis le dernier
  enregistré par `main` (clé
  `army-next-<OS>-<hash package-lock.json et next.config.ts>-<sha>`) ; seul un
  push sur `main` enregistre le sien.
- `E2E_ARMY_WORKERS: "2"` dans l'environnement de la seule étape des parcours
  critical ([qualification](tester-army-local-development.md)). La suite full
  reste à 1.
- Ctrl+S au lieu de l'autosave à 60 s dans les parcours qui ne qualifient pas
  l'autosave : seul « creation persists … after reload »
  (`estimate-integrity.e2e.ts`) garde l'attente réelle du cycle automatique
  ([cas couverts](tester-army-estimate-cases.md)). `AUTOSAVE_DEBOUNCE_MS` reste
  à 60 000 ; aucun changement produit.
- Instantané de base pré-migrée (`src/test/database-snapshot.ts`), opt-in par
  `ARMY_DB_SNAPSHOT_DIR`, que seule l'étape des parcours critical fixe à
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
  GitHub : restauré à chaque run critical sur la clé exacte
  `army-db-snapshot-v1-<OS>-<arch>-<hash des entrées>`, enregistré seulement
  par un push sur `main` quand la clé exacte est absente du cache (miss). Une
  clé GitHub est immuable : si une restauration y est rejetée, chaque run
  retombe sur `db reset` sans pouvoir la remplacer ; incrémenter alors
  `army-db-snapshot-v1` dans le workflow. `e2e-army-full.yml` et `e2e-rls-matrix.yml` ne le
  définissent pas : un `db reset` complet tourne chaque nuit.

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
  de la PR, suite complète, fait foi.

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
