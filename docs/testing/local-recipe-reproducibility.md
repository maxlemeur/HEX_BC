# Recette locale reproductible

## Reprise rapide après la rétro du 12 octobre

Commencer par `npm run check:army-recipes` : six harnais de refus hors réseau,
60 assertions attendues, arrêt au premier échec, reçus enfants nommés dans la
sortie. Node 24, Git, Python accessible par `python` et création de liens de
répertoire doivent être disponibles. Aucun compte, SQL, HTTP ou navigateur
n'est qualifié par cette commande. Les deux harnais CCTP génèrent maintenant
leurs propres vecteurs de parser ; aucune archive historique n'est nécessaire.
La validation dans une copie sans archives réutilise les dépendances déjà
installées et ne constitue pas une preuve `npm ci` sur une machine neuve.
Sur Windows, le sandbox Codex peut refuser ces liens : conserver le résultat
en échec et exécuter la même commande dans le runtime local autorisé. La
commande a réussi 60/60 dans ce runtime ; le premier échec reste archivé.

Choisir ensuite le contrat de la campagne à exécuter :
[ouvrages](local-recipe-reader.md), [CCTP couverture](local-cctp-recipe.md),
ou [navigation du bail](editor-navigation-lease.md). La verticale
[référence A/B](source-reference-vertical.md) reste distincte.
Le contrôle de portabilité `check-cctp-plan-portability.mjs` exige son plan et
son SHA explicites ; il ne fait pas partie de la commande autonome à 60 cas.

| Information recherchée | Accès direct, sans scan de toutes les archives |
| --- | --- |
| État d'une étape interrompue | `.e2e/army/recipes/campaigns/<campagne>/<étape>-stage-receipt.json`, puis son log nommé |
| Cas SQL, conservation et rollback | `native/receipt.json` : `regression`, `sourceCoverage.regression`, `pgTap`, `rollbackVerified`, `bodiesAndAclVerified` |
| Plan préparé et commits | `plan.json`, `native-seed-prepare/seed-receipt.json`, `native-seed-finalize/seed-receipt.json` pour CCTP |
| Run réellement exécuté | `run-stage.log`, puis l'archive exacte imprimée sous `.e2e/army/coverage/runs/` |
| Verdict indépendant | `read-stage.log`, puis le fichier `qualification.json` du répertoire exact imprimé |
| Échec de setup sans rapport frais | Répertoire daté `runs/<stamp>-setup-failed/`, selon [le contrat d'archivage](tester-army-setup-archive.md) |

Les preuves CCTP/ouvrages du build `yD3yKrjccL8pHYXHZho5a` et les améliorations
postérieures des contrôles sont distinguées dans la
[rétro de recette](../product/retrospective-recette-chiffrage-2026-10-12.md).
Une ancienne qualification ne remplace pas un build correspondant aux nouvelles
modifications produit.

Défaillances définies avant implémentation, le 12 octobre 2026, à partir de
la rétrospective de la session. Cette tranche porte sur les outils de recette.
Les archives historiques restent les preuves de leurs commandes originales.

| Défaillance observable | Refus ou preuve attendue |
| --- | --- |
| Une copie propre appelle un helper executable ignoré ou un chemin utilisateur historique. | Build, transport, seed, profil et lecteur proviennent du dépôt ; configuration locale explicite. |
| Un champ `ready` remplace une qualification native réellement exécutée. | Commandes pgTAP et régression générée, sorties originales, inventaires, corps/ACL, identité et conservation sont reliés par leurs SHA. |
| Le transport cible une pile distante, un workdir lié, un autre port ou système PostgreSQL. | Refus avant seed ; statut CLI, config, origine HTTP et identité PostgreSQL doivent concorder. |
| Le producteur écrit un chemin relatif au dépôt et le lecteur exige à tort un chemin absolu. | Résoudre ce chemin relatif par le garde des fichiers ignorés du dépôt, puis imposer le même fichier exact ; refuser tout autre fichier ou sortie du périmètre. |
| Un compte de recette manquant déclenche une réparation de membership ou RMO. | Refus ; le compte local admin et son rôle de pose 4000 sont des préconditions observées par connexion ordinaire. |
| Le build change pendant sa compilation ou n'exécute pas OpenAPI et les budgets. | Résultat non utilisable ; conserver log, inputs avant/après et codes réels. |
| Le seed réemploie des UUID, crée un résultat final ou modifie des données existantes. | Même contrôle natif transactionnel que le seed actuel ; UUID nouveaux, états pending uniquement, conservation et relecture indépendante. |
| Un processus interrompu est relancé automatiquement après une issue ambiguë. | Aucune reprise implicite ; conserver le répertoire exact et le reçu de l'étape interrompue. |
| Le reçu d'orchestration porte le même nom que celui du seed enfant. | Les deux reçus exclusifs sont conservés sous des noms distincts ; le cycle réel doit atteindre le helper puis vérifier la conservation et la relecture. |
| Un échec Auth puis six skips reçoit un verdict réussi. | Le lecteur exige les sept résultats exacts exécutés et réussis ; absence de sélection, skip, retry ou modèle. |
| Des clés, mots de passe ou sessions arrivent dans les métadonnées et logs. | Configuration non secrète, fichiers env ignorés explicites, logs expurgés avant leurs empreintes. |
| La nouvelle voie casse les profils de la pile historique. | La chaîne historique reste distincte ; relire hors réseau WFC02/GO/batch avant exécution navigateur. |

La validation hors réseau exerce les vrais points d'entrée pour les erreurs
de configuration et la préparation sans mutation. Elle n'est pas une preuve
d'Auth, de seed, de pgTAP, de navigateur ou de qualité métier. Ces erreurs de
ciblage doivent être refusées avant qu'un parcours E2E puisse démarrer ; des
tests de présence de chaînes dans les sources seraient insuffisants.

La précondition native restante est une pile de test déjà démarrée avec les
migrations courantes, les tests SQL correspondants et un compte de test local
admin avec un rôle de pose à 4000 centimes/h. Le bootstrap et l'application de
migrations ne sont pas intégrés à cette commande. La recette qualifie la pile
donnée avant de créer de nouveaux témoins, puis exécute GO01–GO06 sur le build
de production. Les autorisations et résultats restent ceux de la campagne
concrète ; une configuration d'exemple ne confère aucune autorisation.

## Depuis une copie propre

Utiliser Node 24, les dépendances du lockfile (`npm ci` sur copie propre), le
Chromium du runner déjà installé, Python 3.11 et une CLI Supabase native déjà
installée. Sur Windows, Python/CLI/PostgreSQL fonctionnent dans WSL. Les outils
n'installent aucune dépendance. Les exemples de configuration sont dans
`scripts/tester-army/local-recipe-config.example.json` et
`local-native-config.example.json` ; copier et renseigner ces métadonnées sous
`.e2e/`. Remplacer tous les exemples par les chemins, UUID, ports et empreintes
observés. Les fichiers d'environnement secrets restent ignorés et sont chargés
explicitement à chaque commande. La configuration native contient l'empreinte
de `supabase/config.toml`, de la CLI et de `psql`, le workdir physique non lié,
le Node Linux, le `system_identifier` et `server_version_num` observés.

Les préconditions sont une pile locale déjà démarrée, les migrations courantes
déjà appliquées, leurs fichiers et les tests SQL déjà copiés dans son workdir,
un compte local existant admin d'un tenant actif, un rôle à 4000 centimes/h et
un compteur de référence existant. Si une précondition manque, la recette
refuse ; sa réparation doit être décidée séparément. Elle ne lance ni reset,
ni synchronisation, ni migration, ni bootstrap Auth. Réserver un créneau
exclusif pour la qualification native, le seed puis le navigateur.

Toutes les commandes partent de la racine. Exemple de progression PowerShell
(les trois valeurs ci-dessous sont des fichiers locaux explicites à préparer) :

```powershell
$taskConfig = '.e2e/my-campaign/recipe-config.json'
$taskBackend = '.e2e/my-campaign/backend.env'
$taskLogin = '.e2e/my-campaign/login.env'
node scripts/tester-army/check-local-recipe.mjs
node scripts/tester-army/local-recipe.mjs plan --config $taskConfig
node scripts/tester-army/local-recipe.mjs native --config $taskConfig --execute
node --env-file=$taskBackend --env-file=$taskLogin scripts/tester-army/local-recipe.mjs seed --config $taskConfig --execute
node --env-file=$taskBackend scripts/tester-army/build-local.mjs --execute
```

La commande de build imprime son manifeste exact et son SHA. Après ce build,
conserver les sources, scripts, SQL et configuration figés. Le profil exige les
trois commandes effectivement exécutées (OpenAPI, Webpack, budgets), leur code
zéro, l'inventaire complet des entrées avant/après, le diff Git, la révision,
le log et le BUILD_ID. Aucune limite de performance n'est augmentée.

```powershell
$taskBuild = '.e2e/army/recipes/builds/<exact-output>/manifest.json'
$taskBuildSha = '<actual-sha256-printed-by-build>'
node --env-file=$taskBackend --env-file=$taskLogin scripts/tester-army/local-recipe.mjs profile --config $taskConfig --build $taskBuild --build-sha $taskBuildSha
node --env-file=$taskBackend --env-file=$taskLogin scripts/tester-army/local-recipe.mjs collect --config $taskConfig
node --env-file=$taskBackend --env-file=$taskLogin scripts/tester-army/local-recipe.mjs run --config $taskConfig --execute
$taskRun = '.e2e/army/coverage/runs/<exact-terminal-run>'
node --env-file=$taskBackend --env-file=$taskLogin scripts/tester-army/local-recipe.mjs read --config $taskConfig --run $taskRun
```

Le log `run-stage.log` conserve la sortie du runner qui identifie son archive
datée exacte. La lecture utilise cet identifiant ; elle ne choisit jamais le
dernier run. Voir `local-recipe-reader.md` pour les valeurs métier vérifiées.
`collect` découvre sept résultats et ne qualifie aucun parcours. `read` exige
les sept résultats exécutés et réussis, avec assertions chiffrées et sources
courantes. Un succès de connexion seul ne suffit pas.

## Preuves et interruption

`local-native.py` utilise les mêmes primitives que les campagnes locales :
statut Supabase en environnement nettoyé, commande SQL au port exact,
identité PostgreSQL, catalogue/corps/ACL/historique et multiensembles de lignes.
Il exécute la régression spécialisée existante dans son DO obligatoirement
avorté, puis les fichiers pgTAP actuels. Leurs sorties originales, commandes,
cas exacts, plans agrégés, sources initiales et états avant/après sont archivés.
La recette n'invente aucun reçu d'application de migration. Le contrôle des
corps/ACL couvre les fonctions créées ou remplacées par la migration générée.
Les séquences ne constituent pas un scénario de transactions concurrentes.
La conservation couvre les tables public/private, auth.users et les
métadonnées Storage ; elle exclut les autres tables Auth et les octets Storage.

Le seed existant conserve ses assertions transactionnelles et ajoute une voie
explicite vers cette qualification. Il crée uniquement des UUID neufs et des
propositions pending, conserve chaque ligne antérieure et le catalogue, puis
compare la relecture indépendante au snapshot avant commit. La seule mutation
de donnée existante permise est le compteur tenant/année incrémenté exactement
par les six nouvelles affaires via son trigger, avec références vérifiées.
Les nouveaux logs d'audit sont bornés aux identités préparées. La connexion
ordinaire et son sign-out local viennent après la conservation native ; les
métadonnées de session Auth sont hors de cette preuve de conservation.

Chaque étape crée son reçu avec exclusivité. Si elle est interrompue ou échoue,
conserver le répertoire et inspecter le processus et son reçu exact avant toute
nouvelle action. Relancer la même étape ou purger ses UUID n'est jamais
automatique. Une campagne neuve n'efface aucune archive antérieure.

La voie autonome est limitée à generated-recovery et garde une chaîne distincte.
Les profils WFC02/GO/batch historiques conservent leurs règles et leurs reçus
originaux. Leur qualification actuelle exige toujours un build correspondant
aux sources actuelles ; une archive ancienne n'est pas promue en preuve actuelle.

## Validation de l'outillage

`check-local-recipe.mjs` exerce les points d'entrée CLI hors réseau et archive
les commandes, sorties, codes réels et empreintes dans un répertoire neuf.
La première exécution de cette tranche a conservé le refus du point d'entrée
manquant. Ces contrôles ne produisent aucun statut de pile prête ni preuve
pgTAP/Auth/navigateur. La campagne réelle décrite ci-dessous a ensuite été
exécutée après revue des outils et des valeurs de sa configuration.

Validation de cette livraison avant campagne : neuf contrôles CLI passent,
ainsi que la relecture effective hors réseau des trois profils historiques
WFC02, GO et batch (respectivement 71, 70 et 69 entrées de preuve). Commande :
`check-local-recipe.mjs --historical-profile <wfc-profile-exact>
--historical-profile <go-profile-exact> --historical-profile <batch-profile-exact>`
avec les deux fichiers env locaux explicites. Le reçu original est
`.e2e/retro-runtime/checks/39f7b60c-682b-4fc6-a408-0759adfd9fb7/receipt.json`,
SHA `514e228515c55f4d5bcc211591f2685547b4dcd6e05fcec547e87aacd5d316e0`.
Ces douze contrôles qualifient l'outillage hors réseau, sans requalifier les
parcours anciens ni observer une fixture fraîche. La syntaxe Python et le lint
des outils passent. Le lecteur GO refuse la vraie archive de connexion échouée
avec six skips ; il attend le nouveau fait réel de refus `GO03-stale-save-response`.

### Collision observée avant correction

Le premier cycle réel `recipe-go-retro-20261012-01` a qualifié la régression
native (100 cas) et pgTAP (1241 assertions, 13 fichiers). Son seed a ensuite
échoué par `EEXIST` : l'orchestrateur écrivait `seed-receipt.json`, puis
`seed-generated-atomic.mjs` tentait de créer son propre reçu sous le même nom
avec exclusivité. Le refus s'est produit à la création du reçu enfant, avant
`seedNative()` et avant le démarrage du helper Python. La connexion ordinaire
du parent et son sign-out local ont eu lieu ; aucune insertion métier du seed
n'a été effectuée. Le coordinateur contrôle cette absence indépendamment.

Le reçu et le log originaux sous
`.e2e/army/recipes/campaigns/recipe-go-retro-20261012-01/` sont conservés.
La correction garde la création exclusive et distingue le reçu
`${stage}-stage-receipt.json` de l'orchestrateur et le `seed-receipt.json` du
seed. Le cycle neuf `recipe-go-retro-20261012-02` est la régression observable
attendue : reçu d'orchestration terminé, reçu enfant prêt, conservation native
et relecture ordinaire réussies, puis vraie campagne GO. Le cycle 01 n'est ni
repris ni purgé. La première réussite native ne prétend pas qualifier le seed.

### Chemin du reçu observé avant correction

Le cycle réel `recipe-go-retro-20261012-02` a qualifié native et seed, puis
réussi un build stable. Le profil a ensuite refusé le champ
`stack.nativeRecipePath` : son producteur écrit un chemin relatif sous `.e2e/`,
alors que le comparateur utilisé n'acceptait que les chemins absolus Windows
ou WSL. La vérification indépendante confirme que sa résolution par
`ownedPath(root, value)` désigne exactement le fichier natif qualifié. Les
empreintes et les autres prédicats de pile/propriétaire sont corrects.

Le refus `profile-stage-receipt.json` et son profil original sont conservés
dans le cycle 02, avec les données prêtes et non consommées par le navigateur.
La correction est limitée à ce prédicat de la voie autonome : résolution
par le garde existant puis égalité stricte du fichier. Le comparateur des
chemins historiques reste inchangé. Le cycle neuf 03 exécute la recette
complète après reconstruction, sans reprise automatique du cycle 02.

## Résultat exécuté le 12 octobre

Le cycle neuf `recipe-go-retro-20261012-08` réussit les étapes native, seed,
profil, collecte et exécution. La qualification native vérifie 100 cas
séquentiels avec avortement obligatoire et 1 241 assertions pgTAP dans
13 fichiers, puis la conservation des données, du catalogue et des droits.
Reçu `.e2e/army/recipes/campaigns/recipe-go-retro-20261012-08/native/receipt.json`,
SHA `b9acfd53abf0f622ab466e88b2e922f9f5c22f0f347d400117ec0c491a3b6e92`.
Ces contrôles ne rejouent pas les onze courses natives historiques.

Le build explicitement associé est
`.e2e/army/recipes/builds/2026-10-12T18-20-47-211Z-c3b70856/manifest.json`,
SHA `003f40083dbcfab0a6ffa257249fa62fe2103d4e0cd5c30c7700338087841d6f`,
BUILD_ID `1d0jBvzf6x29IoHQUi4Ey`. OpenAPI, Webpack et les cinq budgets passent ;
les sources sont identiques avant/après. L'éditeur reste sous son plafond
inchangé : 499 976 / 500 000 octets gzip.

Archive GO : `.e2e/army/coverage/runs/2026-10-12T18-29-57-281Z`, sept résultats
exécutés et réussis, aucun filtre, skip, retry, modèle ou trace authentifiée.
Le `read-stage` original reste failed pour les sentinelles ambiantes décrites
dans [la procédure de lecture](local-recipe-reader.md). La nouvelle lecture
indépendante qualifie cette archive sans changer le lecteur, les sources,
les archives ou ce reçu échoué : 24 529 contrôles, zéro échec.

La compatibilité avec la voie batch historique passe séparément six résultats
sur le même build dans `2026-10-12T18-46-32-879Z`, avec deux XLSX réels et
3 126 contrôles de qualification. Le cache Chromium déjà présent est fourni
explicitement par `PLAYWRIGHT_BROWSERS_PATH`. Sur cette machine, l'invocation
doit fonctionner hors du sandbox qui refuse l'accès à `/login` ; ce refus
environnemental n'est ni un défaut produit ni une preuve métier réussie.
Les deux setups précédents n'ont pas de manifeste daté complet, car le runner
n'archivait alors que les invocations disposant d'un rapport frais.
Le diagnostic postérieur conserve cette limite ; il ne reconstruit pas une
archive. Le [correctif d'archivage](tester-army-setup-archive.md) est désormais
relu, avec neuf cas de régression exécutés avant/après son implémentation.

## Profil de diagnostic des baux — contrat avant ajout

Le profil explicite `navigation-lease` réutilise le compte et la chaîne
d'installation batch vérifiés, avec une nouvelle affaire pour chaque témoin.
Il doit sélectionner uniquement Auth et les probes navigateur du bail : un
nom de scénario inconnu doit être refusé, sans retomber sur les tests CCTP.
La collecte statique ne prouve ni login ni droits ni exécution de ces probes.
Un mauvais backend, propriétaire, build ou reçu d'installation conserve les
refus existants ; aucune fixture, membership ou permission n'est réparée.

Le premier diagnostic comprend NAV01 et NAV05 ; les autres ordres du
[contrat de bail](editor-navigation-lease.md) restent ouverts tant qu'une
barrière réelle n'a pas été atteinte. Même trois résultats réussis ne doivent
pas devenir une qualification complète de CORE-06. Les résultats échoués,
clones non observés et acquisitions non confirmées doivent être conservés
avant assertion, avec lecture ordinaire et sans UUID de session ou JWT.

Ce diagnostic passe les trois résultats dans
`.e2e/army/coverage/runs/2026-10-12T19-30-14-423Z`, sous le build
`fX0DQh4bn_NqX4V5kfllb` : sources/build stables, aucune sélection filtrée,
skip, reprise, modèle ou trace authentifiée. NAV01 retrouve le champ éditable
397 ms après retour, avec une marge de 118 847 ms avant l'expiration initiale.
NAV05 constate le vrai clone de stockage, l'identité distincte du second
document et sa lecture seule pendant la sauvegarde du premier. Les résultats
et la portée de leur relecture restent dans le [contrat de bail](editor-navigation-lease.md).
