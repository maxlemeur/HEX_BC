# Recette locale DOS-CAL-01

Pour lancer les ouvrages GO01–GO06 depuis une copie propre, suivre
[local-recipe-reproducibility.md](../../docs/testing/local-recipe-reproducibility.md).
Cette voie possède ses helpers natifs, son build, ses données de départ et son
lecteur dans le dépôt. Elle exige une pile et un compte local déjà préparés ;
elle ne remplace pas les autorisations de migration ni les chaînes historiques
décrites ci-dessous. `node scripts/tester-army/local-recipe.mjs --help` affiche
ses étapes explicites. Les résultats métier doivent encore provenir d'une
campagne effectivement exécutée, jamais de l'exemple de configuration.

Le point d'entrée reste `node scripts/run-tester-army.mjs coverage` ;
`coverage-list` collecte uniquement les tests. Les modes existants ne changent
pas de périmètre. La campagne du 12 octobre 2026 à 01:35 UTC a été qualifiée :
douze réussites (connexion et onze parcours métier), aucun scénario ignoré,
26 téléchargements réels. Voir `docs/testing/source-coverage-e2e.md` pour les
archives, les défaillances initiales et les limites de cette preuve locale.

Seul `coverage` ajoute `--max-failures 1` : les douze tests restent sélectionnés, les suivants sont ignorés après un échec et la qualification exige toujours douze réussites ; `coverage-list` n'ajoute pas ce flag.

Lancer avec Node 26.12.1 depuis la racine et charger explicitement les fichiers
d'environnement locaux par `--env-file`, le profil backend puis celui du
nouveau compte de fixture. Le mode coverage ne lit pas `.env.local`.
L'environnement doit fournir `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_LOGIN_EMAIL`,
`E2E_LOGIN_PASSWORD`, `E2E_ALLOWED_SUPABASE_HOST` et
`E2E_COVERAGE_PROFILE_PATH`. Les secrets restent dans les fichiers ignorés,
jamais dans les profils JSON, reçus ou commandes archivées.

Exception explicite pour `coverage-list` : seuls le profil, l'origine publique
et l'hôte autorisé sont requis. La collecte ignore credentials, fixture et
build, marque `not-verified-discovery-only` et n'installe rien. Elle ne devient
pas une fixture prête. `check-coverage-cli.mjs <manifeste-build-exact>` exécute
les quatre refus et cette collecte ; son reçu reste sous `.e2e/`.

Le profil ignoré porte les champs suivants. Les chemins sont relatifs au dépôt,
sous `.e2e/`, et les SHA-256 sont ceux des fichiers réels ; aucun exemple de
profil prêt n'est fourni afin de ne pas donner une autorisation fictive.

| Champ | Contrat |
| --- | --- |
| `schemaVersion`, `scope` | `army-source-coverage-profile-1`, `source-coverage` |
| `approvalReference` | Référence à l'autorisation locale effective de cette campagne |
| `serverMode` | `production` |
| `backendOrigin` | Origine HTTP loopback avec port fixe, égale à l'environnement et à `fixture.apiUrl` |
| `appOrigin` | Origine `http://localhost:<port>` explicite pour l'hydratation Next |
| `fixturePath`, `fixtureSha256` | Fixture neuve prête, schéma `source-coverage-fixture-1`, préfixe `ARMY-COVERAGE-`, propriétaire/tenant/rôle de pose identifiés |
| `buildProofPath`, `buildProofSha256` | Manifeste de build réussi, sources actuelles identiques, bon backend, log et BUILD_ID vérifiés |
| `buildOriginPlatform` | Plateforme du build conservé : `win32`, `linux` ou `darwin` |
| `runtimeReceiptPath`, `runtimeReceiptSha256` | Requis pour un build servi sur une autre plateforme ; Node/distribution et chemins locaux des dépendances doivent correspondre au reçu |

La fixture fournit `owner.userId/tenantId/laborRoleId`, `corpus.A/B.sha256/bytes`
et les scénarios `nominal`, `reference`, `register`, `l2_quantity`, `l1_quantity`,
`l4_quantity`, `l2_price`, `recovery`, `read_failure`, `stale`, `form_change`.
Chaque scénario identifie `projectId/versionId/sectionA/sectionB/draftId/
candidateId/designation/documents.A/documents.B`. Les applications, snapshots,
exigences, citations vérifiées et décisions ne sont pas préinsérés.

Le runtime Windows/WSL est explicitement décrit par le profil, sans port ni
nom de distribution figé dans le code durable. Il n'installe rien. Le garde
serveur refuse les origines sortantes autres que l'application et le backend
autorisés ; les clés de génération sont vidées. Le navigateur conserve son
contrôle d'origine et le seul lookup `delivery_sites` en lecture nécessaire
au registre de l'affaire. Les traces authentifiées restent désactivées.

Les résultats vont dans `.e2e/army/coverage/`, puis dans une archive datée de
`runs/`. Les entrées de profil et le journal réseau ont un nom propre au run ;
les archives précédentes ne sont pas réécrites. Les secrets configurés, JWT
et sessions de verrou repérés sont masqués avant les empreintes des artefacts.
Le manifeste distingue build et plateforme d'exécution, données préparées,
commandes, hashes des sources, résultats réels, exports et exclusions.

Une collecte, un build ou la réussite du seul login ne qualifie pas les décisions.
Les courses SQL, la matrice complète des droits, la disparition des dépendances,
la duplication et les mutations heures/marge/ordre restent séparées des onze
parcours métier actuellement écrits. Ne lancer aucune recette sans le créneau
du coordinateur, le schéma local vérifié et une fixture fraîche autorisée.

`qualify-source-coverage.mjs <run-exact>` est le lecteur distinct dont une
copie indépendante identique a qualifié cette campagne. Il exige les douze
résultats nommés, les sources/build actuels, les
artefacts hachés, S0/S1 réels, reprise/historique et scan de confidentialité.
Il crée un reçu neuf ; aucun ancien GREEN n'est choisi automatiquement.
La sélection des preuves utilise le nom complet avec `fixturePrefix`, afin
de distinguer `s0` de `exports-s0`. Le lecteur corrigé et ce README ont été
promus après cette qualification ; l'archive garde les sources de son propre
run et son reçu daté. Requalifier une archive ancienne exige ses entrées
gelées, comme pour toute autre évolution ultérieure des outils.

## Préparation des préconditions

`seed-source-coverage.mjs` prépare de nouvelles fixtures pour chaque campagne.
Après vérification de l'autorisation et du créneau, il exige
`--execute --profile <chemin-relatif-sous-.e2e>`.
`--help` et `node --check` ne contactent aucun service. Le profil de seed est
distinct du profil de campagne et ne contient aucun secret :

| Champ | Contrat |
| --- | --- |
| `schemaVersion`, `scope` | `army-source-coverage-seed-1`, `source-coverage-prerequisites` |
| `campaign`, `approvalReference` | Nom neuf et référence à l'autorisation effective du créneau |
| `backendOrigin` | Origine loopback exacte, égale aux variables explicites et aux reçus |
| `targetMode` | `existing-stack` par défaut ; `fresh-stack` uniquement sur choix explicite |
| `stackReceiptPath`, `stackReceiptSha256` | Pile native prête, API et répertoire de pile identifiés |
| `nativeApplicationPath`, `nativeApplicationSha256` | Application SQL `verified`, même pile, `migration.file/sha256` identiques au fichier actuel |
| `sentinelFixturePath`, `sentinelFixtureSha256` | Mode existant : fixture locale avec `ownerId/tenantId/projectId/versionId` ; lecture seule avant/après. Interdits en mode neuf. |
| `runtimeReceiptPath`, `runtimeReceiptSha256` | Runtime explicite ; requis hors Windows, Node/distribution/esbuild vérifiés |

Le seed crée uniquement un nouvel acteur avec son tenant de bootstrap, son
rôle de pose à 4 000 centimes/h, et onze affaires indépendantes. Chacune reçoit
une version vide à deux sections SA/SB, une proposition à revoir de trois
composants, puis les vrais documents intake A/B. Les fichiers proviennent de
`e2e/fixtures/source-coverage` ; chemins et métadonnées utilisent les
constructeurs canoniques. Les uploads sont inertes, sans classification IA.

Les applications d'ouvrage, snapshots, lignes finales, entrées du registre,
copies de référence et exigences restent à créer par les parcours réels.
Les lectures ordinaires contrôlent les états publics et les octets Storage ;
elles ne prétendent pas inspecter les tables privées de couverture. Le reçu
conserve explicitement cette limite et n'est pas une qualification métier.

Le répertoire neuf `.e2e/army/coverage/fixtures/<campaign>` conserve le plan
d'UUID, les opérations en cours, les lectures initiales et leurs SHA. Le
fichier `local.env` ignoré contient les credentials du nouvel acteur ; la
clé de provisionnement reste dans le profil d'environnement de base. Aucun
secret, JWT ou corps d'authentification n'est archivé dans les reçus.
`fixture.json` prêt est écrit seulement après toutes les vérifications.
Un échec de mutation garde un état ambigu et interdit toute reprise
automatique : inspecter ce reçu avant de décider d'un nouveau créneau.

Le mode `fresh-stack` ajoute les champs de profil
`freshStackProofPath/freshStackProofSha256`,
`excludedStackReceiptPath/excludedStackReceiptSha256`,
`expectedFreshProjectId` et `expectedFreshSystemIdentifier`. La pile exclue
est identifiée par son reçu local ; le seed ne s'y connecte jamais. Les huit
ports, l'origine, le project_id et le répertoire de la nouvelle pile doivent
être distincts. Aucun port ni ancienne identité n'est figé dans le code.

Le reçu `source-coverage-fresh-stack-1` doit être `verified`, dater de moins
de quinze minutes et correspondre au SHA du reçu de pile, au candidat et à
tous les fichiers de migration actuels. Il porte `migrationHistoryVerified`
et `pgTapPassed`, l'identité PostgreSQL réelle, ainsi que l'inventaire natif
`emptyBeforeFixtures` de tous les états métier publics et privés. Seul le
tenant natif `hydro-express` sans créateur est autorisé à préexister : son
UUID est attesté dans `baselineTenants`. Ce n'est pas une sentinelle métier.

Avant Auth, le seed relit uniquement les tables publiques vides et ce tenant
de base sur la nouvelle API. Il crée un claim local exclusif par identité de
pile sous `.e2e/army/coverage/fresh-stack-claims/`, conservé même après échec,
puis utilise le même provisionnement canonique que le mode existant. Le
reçu final distingue le contrôle natif initial, les lectures REST réellement
exécutées et l'absence de contrôle historique ou privé après provisionnement.
Il n'attribue pas `sentinelUnchanged:true` au mode neuf.

## Ordre d'exécution sur une nouvelle pile

Les fichiers `*.pending.json` sont des brouillons hors connexion : leurs SHA,
identités manquantes et autorisations nulles ne constituent pas un profil
exécutable. Écrire de nouveaux `seed-profile.json` et `run-profile.json`
seulement à partir des reçus réellement qualifiés, sans réécrire les brouillons.

1. Obtenir l'env privé du **nouveau** workdir par `status --env` capturé en
   mémoire, après vérification du reçu/config/ports avec le helper natif.
   Ne jamais afficher ni faire `Get-Content` de cet env. Cette lecture peut
   préparer un build alors que pgTAP reste en échec ; son reçu conserve cet
   état et n'autorise pas le seed.
2. Sous PowerShell, avec l'index alternatif et aucun autre runner actif,
   lancer le build neuf. L'URL et la clé publique sont figées à ce moment ;
   ne pas réutiliser le build de l'ancienne pile :

```powershell
$env:GIT_INDEX_FILE = 'C:/Users/maxim/Projects/miaouffrage/.e2e/git-index-recovery/head.index'
$env:GIT_OPTIONAL_LOCKS = '0'
node --env-file=<backend.env-neuf> .e2e/product-foundation/build.cjs
```

3. Attendre `stack.json:ready`, le bucket privé vérifié, puis obtenir le
   `fresh-proof-<id>.json` **explicite** par l'inspecteur natif. Renseigner le
   profil seed avec ces chemins/SHA, l'identité PostgreSQL observée et la
   référence d'autorisation root. Le même fresh proof peut remplir
   `nativeApplicationPath` et `freshStackProofPath`. Ne jamais sélectionner
   un fichier par « dernier réussi ».
4. Dans le runtime WSL vérifié, depuis la racine du dépôt, créer les seules
   préconditions autorisées. Charger uniquement l'env de cette nouvelle pile :

```bash
GIT_INDEX_FILE="$PWD/.e2e/git-index-recovery/head.index" GIT_OPTIONAL_LOCKS=0 \
  <node26-verifie> --env-file=<backend.env-neuf> \
  scripts/tester-army/seed-source-coverage.mjs \
  --execute --profile <seed-profile.json-exact>
```

5. Après `fixture.json:ready`, renseigner le profil de campagne avec son SHA
   et le manifeste du nouveau build. Lancer depuis le même runtime WSL :

```bash
GIT_INDEX_FILE="$PWD/.e2e/git-index-recovery/head.index" GIT_OPTIONAL_LOCKS=0 \
  E2E_COVERAGE_PROFILE_PATH=<run-profile.json-exact> \
  <node26-verifie> --env-file=<backend.env-neuf> \
  --env-file=.e2e/army/coverage/fixtures/<campagne>/local.env \
  scripts/run-tester-army.mjs coverage
```

6. Qualifier uniquement l'archive terminale exacte, avec le même env de
   campagne chargé pour le scan des secrets configurés :

```bash
GIT_INDEX_FILE="$PWD/.e2e/git-index-recovery/head.index" GIT_OPTIONAL_LOCKS=0 \
  <node26-verifie> --env-file=<backend.env-neuf> \
  --env-file=.e2e/army/coverage/fixtures/<campagne>/local.env \
  scripts/tester-army/qualify-source-coverage.mjs <run-terminal-exact>
```

Les chevrons désignent des valeurs à remplacer par les chemins explicitement
reçus, jamais des valeurs à deviner. Les commandes WSL sont exécutées depuis
la distribution du reçu runtime. Ni le seed ni le runner ne réparent une
pile, ne relancent son reset ou ne modifient les règles de ports Windows.

Première exécution du seed : `coverage-fresh-01`, terminée exit0 le
12 octobre 2026 à 00:38:51 UTC, sur la nouvelle pile identifiée par le reçu
`disposable-native/runs/729799711d9c404b`. Onze sœurs et leurs 22 PDF ont été
relus sous le compte ordinaire ; aucune ligne finale, application, snapshot
ou entrée du registre n'est préinsérée. Le profil réel de campagne a passé
ses contrôles hors réseau. Après les courses natives, la première recette
UI a été interrompue sur une divergence de totaux avant S0 : aucun scénario
de couverture n'est qualifié par ce run.

La préparation suivante `coverage-existing-02` termine exit0 à 00:54:15 UTC.
Elle utilise le mode `existing-stack` et une sentinelle réelle du premier
run, dont les empreintes projet/version restent identiques. Elle crée onze
nouveaux dossiers sans réécrire les précédents ; ne jamais réutiliser le
fresh proof consommé comme attestation d'une pile encore vide. Le prochain
lancement UI exige le nouveau build, son profil exact et le créneau root.
Les reçus et limites sont référencés dans `docs/testing/source-coverage-e2e.md`.
# CORE-08 — création atomique (préparation avant correction)

Le même profil accepte `scenarioSet: "create-atomic"` pour sélectionner uniquement l’authentification et CA01/CA02/CA03 dans `estimate-create-atomic.e2e.ts` : quatre résultats attendus, `--max-failures 3` en exécution pour conserver les diagnostics des trois parcours, aucun flag fail-fast en découverte. Le mode CCTP reste à douze résultats et `--max-failures 1`. Le seed existant accepte ce même sélecteur et ne prépare alors qu’un nouvel acteur/tenant/RMO4000 et deux devis V1 vides ; les V2 et tous les items sont créés par les API ordinaires dans la recette. La preuve du nouveau lot exige son propre verdict ; le qualificateur CCTP ne s’applique pas. Contrat : [estimate-create-atomic.md](../../docs/testing/estimate-create-atomic.md).

Le lecteur `scripts/tester-army/qualify-estimate-create-atomic.mjs <run-exact>` exige quatre résultats GREEN, sans sélection automatique du dernier run. Ses résultats sont ignorés sous `.e2e/army/coverage/atomic-qualifications/`. La campagne du 12 octobre à 02:37 UTC est qualifiée 4/4, avec deux vrais téléchargements et 2592 contrôles ; baselines RED, correction du lecteur après constat d’un nom de téléchargement sans extension, reçus et limites sont conservés dans le contrat lié ci-dessus. La requalification CCTP sur la création atomique reste une campagne distincte à douze résultats.

Cette requalification CCTP termine à 02:57 UTC : archive
`runs/2026-10-12T02-44-52-792Z`, **12/12 et 3158 contrôles**, zéro échec,
26 téléchargements, sources stables. Son reçu et ses limites sont détaillés
dans [source-coverage-e2e.md](../../docs/testing/source-coverage-e2e.md).

Le profil `scenarioSet: "batch-atomic"` réemploie les mêmes gardes et le
format de fixture CORE-08 pour sélectionner l'authentification, WFC01 et
BC01–BC04 (six résultats, `--max-failures 1`). Il réutilise uniquement l'acteur de
fixture : le parcours crée un nouveau projet et ses lignes via les API
ordinaires. Il fournit une `operation_key` et vérifie le premier GET après
l'échec tardif d'un batch, avant ouverture, reload et exports. Aucun seed
supplémentaire ni succès WFC n'est déduit des campagnes précédentes. La
baseline initiale WFC01 à deux résultats reste archivée avec sa sélection
originale ; son RED financier et la matrice client pré-code sont documentés
dans [estimate-workflow-atomicity.md](../../docs/testing/estimate-workflow-atomicity.md)
et [estimate-batch-client-e2e.md](../../docs/testing/estimate-batch-client-e2e.md).

Pour cette première campagne batch, le profil conserve la pile CORE-08
qualifiée sous `atomicPredecessorStackPath/Sha256`, puis exige le reçu
`batchApplicationPath/Sha256` et son nouveau transport `stackReceiptPath/Sha256`.
Le chargeur vérifie les identités, la conservation déclarée, les octets de
migration, l'inventaire augmenté d'une seule migration et les artefacts
d'installation. Il archive les deux piles séparément. Le nouveau transport
porte explicitement `pgTapPassed:false` : l'ancien pgTAP reste historique.
Le lecteur batch réutilise cette vérification sur le profil archivé et exige
les mêmes empreintes dans le run ; aucune course ou suite native nouvelle
n'est déduite de la réussite UI.

La campagne batch du12 octobre à03:52 UTC est qualifiée **6/6**, avec2640
contrôles sans échec, deux téléchargements réels et zéro appel modèle. Archive
`runs/2026-10-12T03-52-42-188Z` ; la première campagne5/6 et le défaut du message
de collage partiel restent conservés. Les reçus et limites sont détaillés dans
[estimate-batch-client-e2e.md](../../docs/testing/estimate-batch-client-e2e.md).

