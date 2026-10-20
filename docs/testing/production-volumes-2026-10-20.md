# Gros volumes et exports réels en production — 20 octobre 2026

Le propriétaire demande explicitement les gros volumes et téléchargements PDF/CSV
avec son compte existant, puis la correction des problèmes reproduits. Les tests
créent seulement des brouillons ARMY identifiables ; aucun envoi, émission,
achat, changement d'accès ou migration distante n'est inclus.

## Échecs observables et protocole avant correction

- Un export PDF peut échouer avant tout téléchargement. Le petit brouillon ARMY
  conservé (`27b8026c-4e92-49e3-b7c8-b7630651420a`, version
  `872b4338-8ef1-41a2-a2ba-a44aefa666dd`) doit produire un vrai PDF contenant la
  ligne 2 u × 130 €, HT 260 €, TVA 52 €, TTC 312 €.
- Un gros devis peut être tronqué au-delà de 1 000 items, figer l'éditeur, perdre
  une édition, ou produire un export partiel. L'import du classeur OPTIMA public
  réaliste de 2 031 items, l'édition/sauvegarde/rechargement et le contrôle des
  lignes et montants des fichiers téléchargés exposent ces erreurs.
- Une liste ou un CSV peut ne couvrir que la page visible. La sélection de
  fixtures ARMY et les oracles du fichier doivent comparer toutes les références,
  lignes métier et valeurs numériques attendues, dernière ligne comprise.
- Les montants du PDF/CSV peuvent diverger de la version persistée. Les assertions
  portent sur les valeurs entières en centimes et la quantité, sans émission.

Premier rouge réel : la génération PDF du petit brouillon affiche « Impossible
de générer le binaire PDF. ». Les logs Vercel de
`dpl_D7hM9SS2iq3gRDoiTovJRhN3Y5ht`, source
`3d04d5fe9fc76e25ca79876cc64ceb7a4b5e3c56`, donnent `MODULE_NOT_FOUND` pour
`/var/task/node_modules/pdfkit/js/standard-fonts/Helvetica.cjs`.
Le premier onglet gardait le footer client `44a969d` de la campagne précédente ;
après rafraîchissement, le footer confirme `3d04d5f`. Cette différence est retenue
dans l'annotation d'identité, sans attribuer le serveur courant à l'ancien build.

Régression spécialisée nécessaire : le serveur local et les tests métier ont
accès au `node_modules` complet, qui masque l'omission des fichiers du paquet
livré. `scripts/check-pdf-runtime.mjs` reconstruit donc uniquement les dépendances
déclarées par la trace Next du handler PDF, dans un répertoire temporaire isolé,
et appelle le vrai `renderToBuffer` avec les 12 polices standard prises en charge
par React PDF. Le test est écrit
et exécuté avant la correction ; aucun mock, compte, SQL ou réseau n'est utilisé.
L'export du même brouillon en production devra ensuite confirmer le correctif.

## Correctif PDF qualifié localement

L'inclusion explicite des modules CJS `pdfkit/js/standard-fonts/**/*.cjs` dans
les fonctions `/api/estimates/**` répare le paquet livré. Le contrôle du vrai
renderer est exécuté par le build normal et les recettes Army. Il couvre les
polices chargées à la demande et leur chunk partagé ; aucun changement de schéma,
d'autorisation, d'API publique ou de dépendance n'est nécessaire.

- Rouge isolé : `traced-pdf-red.json`, même erreur `Helvetica.cjs` que Vercel.
- Vert isolé : `traced-pdf-green.json`, 12 polices, PDF complet de 3 372 octets.
- `mise exec node@24.19.0 -- npm run verify:pr` : succès, 3 321 tests Node,
  820 jsdom et 12 contrôles de couverture critique passés. Les trois tests déjà
  ignorés du projet Node restent absents de cette preuve.
- `mise exec node@24.19.0 -- npm run verify:production` : succès sur les sources
  corrigées, build Webpack, contrôle PDF isolé et smoke HTTP de production.
  Ces deux commandes exécutent les deux composantes de `check:release`.
- Revue indépendante en lecture seule du diff stabilisé : aucun défaut
  actionnable ; les quatre consommateurs PDF, envoi, émission et changelog sont
  couverts par l'inclusion. Le vert local ne prouve pas encore le téléchargement
  réel après déploiement.

L'essai de publication précédent a d'abord rencontré la restriction sandbox du
port local ; sa relance autorisée a ensuite signalé une police de sonde non prise
en charge par React PDF (`Symbol`). La sonde est limitée aux 12 familles réellement
prises en charge et le build final ci-dessus a été exécuté à nouveau. Ces échecs
de harnais restent distingués de la panne produit reproduite.

Preuves locales de cette campagne : `.e2e/army/production-volumes-20261020/`.
Logs de qualité et publication :
`/private/tmp/mergeone-prod-pdf-quality-20261020.log` et
`/private/tmp/mergeone-prod-pdf-publication-final-20261020.log`.
Les parcours de gros volume et le contrôle des téléchargements en production
restent en cours à ce stade du rapport.

## Deuxième lot : téléchargements et coût des comparaisons fournisseur

Rouges observés avant son implémentation : le PDF prêt n'ouvre aucun onglet et
n'apparaît pas dans les téléchargements Chrome ; l'export CSV du devis importé
répond 200 mais attend 224 862 ms avant ses en-têtes. Le fichier de 244 475 octets
est finalement reçu et conservé (`devis-production-2031-before.csv`). Le devis a
2 031 items (131 sections et 1 900 lignes), sans ligne rejetée. Le CSV de commandes
distinct passe déjà ses assertions sur 1 005 lignes et six brouillons ARMY.

Défaillances à prévenir : annoncer un téléchargement sans avoir reçu son binaire,
masquer une erreur Storage, multiplier les recherches de catalogue sans candidat,
ou supprimer une alternative fournisseur existante lors de l'optimisation. Les
recherches qui peuvent correspondre, les choix fournisseur conservés et les cas
que l'index borné ne peut exclure doivent conserver le parcours actuel. Aucun
plafond de temps, contrat de prix ou contrôle d'accès ne sera assoupli.

Le parcours réel doit télécharger le PDF et le CSV du même devis, contrôler
toutes les lignes, la dernière comprise, et comparer leurs montants aux valeurs
persistées. Un contrôle isolé préalable couvre les cas de texte Unicode et les
caractères que le filtre SQL normalise : un parcours de volume sans correspondance
ne peut détecter seul une fausse exclusion sur ces entrées. Le contrôle du
téléchargement refusé évite aussi qu'un simple statut PDF prêt soit présenté
comme une réception réussie du fichier.

Les corrections du deuxième lot sont qualifiées localement :

- Le téléchargement PDF reçoit et vérifie le binaire autorisé avant de déclencher
  un téléchargement normal ; une réponse HTML ou une erreur HTTP ne produit plus
  une notification de succès. Le contrôle d'accès existant reste inchangé.
- Pour les exports de plus de 200 lignes, un index fournisseur borné à 2 000
  entrées par table élimine seulement les recherches impossibles. Il lit toutes
  ses pages sous RLS et filtre le tenant. Un catalogue trop grand, un texte
  incertain ou une sélection inconnue conserve le parcours de comparaison actuel.
  Aucun montant, choix fournisseur ou calcul n'est modifié.
- Les logs de `bee01639` ont révélé le même défaut de police dans les pages qui
  chargent les actions partagées. L'inclusion des CJS couvre maintenant toutes
  les routes. Le garde de build vérifie les fontes et leur chunk dans les
  **208 traces** qui chargent PDFKit, puis exécute le vrai renderer isolé.
- La revue indépendante a détecté une métadonnée fournisseur omise traitée comme
  absente. Son oracle a d'abord échoué, puis passé après conservation du chemin
  original pour `undefined`. Une correction ciblée couvre aussi le recensement
  récursif des chunks des fontes. Aucun défaut restant signalé par la revue.
- `mise exec node@24.19.0 -- npm run check:release` : succès, **3 330 tests Node,
  820 jsdom, 12 contrôles critiques**, build, garde PDF et smoke HTTP. Les trois
  tests Node déjà ignorés restent non exécutés.
- `mise exec node@24.19.0 -- npm run e2e:army:local -- --grep 'IO01'`, dans le
  clone propre `/private/tmp/mergeone-exports-20261020` : **2/2** avec connexion,
  sources inchangées, sans retry ni appel modèle. Import OPTIMA, assertions des
  785 prix, 1 900 lignes du CSV, montants exacts, et téléchargement PDF réel.
  CSV reçu en **7 814 ms** pour un budget local de 10 000 ms. Le garde des chunks
  a été complété ensuite ; le code applicatif exécuté est identique.
  Le lancement initial depuis le checkout principal a été refusé à cause de son
  `.env.local`, sans action distante ; ce refus n'est pas une preuve métier.

Les logs sont `/private/tmp/mergeone-exports-release-final-20261020.log` et
`/private/tmp/mergeone-exports-io01-isolated-20261020.log`. Reçu, manifeste et
chemin des fichiers : `io01-receipt.json` dans le dossier de preuves et
`/private/tmp/mergeone-exports-20261020/.e2e/army/ci/2026-10-20T21-07-12-532Z-critical/`.
Le rejeu de ces téléchargements sur le nouveau déploiement reste à effectuer.

## Oracles de production déjà exécutés

Le gros devis est la version `b52e9bc9-6a8d-4549-b89b-7717794fdba6` de l'affaire
`c3954356-e60d-4d51-bc01-5255dc474ae4`, `ARMY-PROD-LARGE-20261020-OPTIMA`.
Le classeur public `e2e/fixtures/business/optima-hydraulique-fictif.xlsx`
(SHA-256 `cfedeb15a0d2c1bd9dc58d1174ed27d9a341bd048be168f56ae1d4d390f31acd`)
produit 131 sections et 1 900 lignes. Le rôle existant choisi dans ce compte
vaut **50 €/h**, et non les 40 €/h du classeur ; aucun réglage global n'est
modifié et le total du classeur à 40 €/h n'est donc pas présenté comme oracle.
La première quantité passée de 1 à 2 persiste après sauvegarde automatique
(cadence prévue : 60 s) et rechargement. Valeurs sauvegardées : HT **85 657,01 €**,
TVA **17 131,40 €**, TTC **102 788,41 €**.

Le CSV initial et le PDF de 71 pages généré par `bee01639` passent l'oracle sur
**tous les 1 900 titres uniques**, chaque PU et total HT chiffré, chaque statut
non chiffré et les totaux du document. Dernière ligne : `Réserve fictive 1036`.
Le PDF de 310 879 octets a été reçu par le GET binaire authentifié de l'application
après génération ; il ne qualifie pas encore le téléchargement par le bouton.
`verify_estimate_exports.py`, `devis-production-2031-before-oracle.json` et les
fichiers originaux restent dans le dossier de preuves ignoré.

Pour les commandes, six nouveaux brouillons ARMY, dont une commande de 1 000
lignes, donnent un CSV de **1 005 lignes**, reçu en **2 566 ms**. L'oracle vérifie
toutes les références sans doublon/troncature, quantités, unités, prix, TVA,
totaux, et la désignation finale contenant point-virgule, guillemets et retour
à la ligne. Il ne qualifie pas 1 005 en-têtes de commandes en production.
Références conservées : `C-2610-043` à `C-2610-048` ; fournisseur et chantier
`ARMY-PROD-ORDERS-20261020`. Aucun envoi ni achat effectué.

## Rouge CI du deuxième lot, avant correction complémentaire

Le commit `2f41de4db5ba3d3e27ec1ff95eff724744fbc532` passe la qualité et le smoke,
mais IO01 échoue au budget CSV : **20 231 ms > 10 000 ms**, avec les 1 900 lignes
reçues. Run `39498510766`, job `118889806115`, artefact
`army-critical-shard-4-evidence` (`12299252606`, SHA-256
`909324a1ca587b13b9af4088da7ff982c0692f1f8cb33dfeb543cb3a5b8b1ee3`).
Le déploiement de ce commit reste en attente. Ce rouge n'est pas requalifié par
le vert local précédent et le budget n'est pas augmenté.

Le CSV utilise les items du document v3, mais recharge aussi tous les items et
leur provenance enrichie via `getEstimateVersionDetails`, uniquement pour ses
métadonnées (identité et libellés de rôles/fournitures). La correction ciblée
doit omettre cette seconde lecture explicitement dans ce seul appelant, en
conservant l'autorisation propriétaire/tenant et le contrôle de révision. Le
parcours IO01 existant fournit le rouge/vert de latence et l'oracle complet ;
un test isolé de simple transmission d'option n'ajouterait aucune preuve.

Le premier rejeu local de cette correction reste rouge à **11 105 ms**. Le filtre
conservateur conserve aussi toutes les 1 036 désignations « Réserve », à cause de
leur accent, même en l'absence du fragment numérique dans le catalogue. Une
condition nécessaire plus simple doit exclure ces recherches : les chiffres
ASCII contigus de la requête doivent exister dans au moins une valeur indexée.
Le nettoyage SQL retire des signes, jamais ces chiffres. Les cas incertains
sans chiffres et les candidats conservant le fragment restent sur le chemin
actuel. L'oracle Unicode/ponctuation est enrichi et exécuté avant cette seconde
correction ; le même parcours IO01 et le même budget seront rejoués.

Le rejeu final de la correction complémentaire passe **2/2**, sources inchangées,
sans retry ni modèle : **358 ms** pour le CSV complet de 1 900 lignes, budget
inchangé de 10 000 ms, puis vrai téléchargement PDF de 310 976 octets. Les
contrôles SQL/RLS de sa pile jetable passent également ; ce run ne remplace pas
la mesure des plafonds SQL en WSL. Reçu : `io01-ci-fix-receipt.json`, archive
`/private/tmp/mergeone-exports-ci-fix-20261020/.e2e/army/ci/2026-10-20T21-28-22-885Z-critical/`.

La revue indépendante valide l'option de métadonnées et le préfiltre numérique,
avec ses contre-exemples conservés. `mise exec node@24.19.0 -- npm run
check:release` passe à nouveau sur ces sources (qualité, build, garde PDF et smoke
HTTP), journal `/private/tmp/mergeone-exports-ci-fix-release-final-20261020.log`.
Le push correctif, sa CI et le rejeu en production restent à effectuer.

## Lecture du gros devis : constat et régression prévue

Sur la production `bee01639`, la requête GET du devis de 2 031 items dure
**20 108 ms** (19 689 ms avant les en-têtes), mesurés par Resource Timing dans
l'éditeur réellement connecté. La recherche de la dernière ligne reste réactive
(71 ms de harnais), et le rechargement conserve la quantité éditée à 2.
Preuve : `large-editor-network-timing-before.json`.

La lecture de provenance IA et d'ouvrages interroge séquentiellement les
applications par groupes de 150 identifiants, même lorsqu'il n'en existe aucune.
La correction envisagée cible les items de la version autorisée par leur clé
étrangère, filtre toujours le tenant et conserve une pagination exhaustive.
Les appels qui n'ont pas de version conservent la lecture par identifiants.
Aucune limite d'URL, vérification d'accès ou donnée métier ne change.

Avant cette implémentation, le parcours LOCK01 est renforcé pour vérifier la
provenance d'une structure appliquée, immédiatement puis après rechargement.
IO01 conserve son budget de lecture de 10 s, ses 785 prix et ses exports complets.
GC02 contrôle la provenance d'un ouvrage appliqué et sa réutilisation. Ces
parcours positifs empêchent qu'une lecture vide et rapide masque la perte des
preuves ; ils sont exécutés sur une pile locale possédée, sans fournisseur IA.


Qualification de cette lecture : IO01 + LOCK01 **3/3** (setup compris), lecture
complète OPTIMA **235 ms**, CSV **350 ms**, PDF réellement téléchargé de 311 017
octets. GC02, phase `components` filtrée, **2/2** avec son setup : montants,
provenance après application et réutilisation vérifiés. Archives canoniques :
`.e2e/army/ci/2026-10-20T21-40-05-244Z-critical/` et
`.e2e/army/ci/2026-10-20T21-41-28-872Z-calc-v3/`. La normalisation des deux
nouvelles fins de ligne du serveur est sans effet sur le code exécuté par le
premier run ; le second run utilise ces octets finaux. Revue indépendante du diff
stable : aucun défaut actionnable.

La CI du commit `11bb9b9a` a passé le CSV (1 169 ms), puis échoué pendant
l'enregistrement du PDF : l'alerte de l'application est « Impossible d'enregistrer
le PDF », et non un dépassement du budget CSV. Le run
`39501143681`, job `118898721412`, conserve l'échec ; ZIP `12302045688`, SHA256
`09f74eb543feb8f990db0464ea1ba10c61c4efd82018bb854c60e64321db4de8`.
La cause Storage précise n'est pas observable dans ce run. Un diagnostic borné
est ajouté côté serveur (classe, code fournisseur autorisé, statut HTTP, taille),
sans message fournisseur, chemin objet, requête imbriquée ni jeton. Le test
spécialisé de conservation de cette frontière et du marquage d'échec est rouge
avant cet ajout puis vert (32 tests du générateur). Les timeouts, budgets et
retries sont inchangés. Un nouveau vert ne suffira pas à attribuer cette erreur
Storage à l'optimisation de provenance ; le rejeu exact de CI reste nécessaire.


La qualification finale `mise exec node@24.19.0 -- npm run check:release` passe
sur ce diff : tests Node/jsdom, couverture critique, build Webpack, garde PDF et
smoke HTTP. Log : `/private/tmp/mergeone-provenance-release-final-20261020.log`.
La revue ciblée du diagnostic ne trouve aucun défaut ; la normalisation de sa
seule ligne d'import est une modification de fin de ligne sans effet exécuté.
Les assertions et sorties d'échec ne sont pas assouplies. CI et production de ce
lot restent à qualifier après son push.


## Panne réseau de la pile CI : runtime et diagnostic

Le run `39503339897` sur `2159f1b2` reproduit le même échec PDF. Le diagnostic
établit que le rendu est terminé (**311 018 octets**) et que Storage renvoie une
`StorageUnknownError`, sans statut HTTP. Artefact `12301843422`, SHA256
`9ca08d9e5742cab3fcd980ebbb97cd2089a7c474ab9d0b0c207d0ebd5cfac331`.
Un reproducer HTTP local de fermeture keep-alive ne reproduit pas l'erreur ;
aucun yield, retry ou correctif supposé de connexion n'est adopté sur cette base.

Le diagnostic est complété par des codes réseau et catégories fermées issus de
`originalError`/`cause`, sans sérialiser leurs messages ni requêtes. Son nouveau
oracle est rouge avant l'ajout puis vert (**33/33** tests du générateur).

La [release officielle Supabase CLI 2.121.0](https://github.com/supabase/cli/releases/tag/v2.121.0)
contient le [pool de connexions pour les écritures du gateway](https://github.com/supabase/cli/pull/7075).
Le correctif upstream explique que RPC, créations Auth et uploads ouvraient une
connexion neuve par écriture et pouvaient épuiser les ports ; les écritures ne
sont toujours jamais renvoyées. Ce mécanisme est compatible avec l'échec de la
suite complète, absent du petit run local, sans constituer seul une attribution
prouvée de la cause exacte. La mise à jour de l'outil de test **2.120.0 → 2.121.0**
est donc qualifiée avec IO01 et LOCK01, pgTAP et matrice RLS de leur pile possédée.
Les deux gardes de version sont mis à jour avant le pin (rouges attendus) ; la
version précédente reste un contre-exemple refusé avant toute pile. Les erreurs
de bind de la tentative sandbox sont distinctes de ces rouges de contrat.
Aucune migration ou configuration distante, aucun délai ou retry ne change.


Le premier démarrage avec 2.121 est refusé avant les parcours : l'inspector
18651 tombe dans la nouvelle plage interne 10000–19999. L'allocateur public
central exclut maintenant toute cette plage, en plus des ports navigateur,
ports clients éphémères et ports déjà réservés. La régression spécialisée est
rouge avant ce filtre (10000 attribué), puis les 112 tests ciblés passent
(1 test préexistant non applicable reste ignoré). Le test de copie réelle de
configuration conserve son oracle et choisit 26384–26447. Aucun service partagé
n'est concerné. Le démarrage refusé reste archivé comme échec de préparation.


La nouvelle pile **CLI2.121.0** passe IO01 et LOCK01 : **3/3**, connexion incluse,
avec pgTAP et matrice RLS du lanceur. Archive canonique
`.e2e/army/ci/2026-10-20T22-05-53-209Z-critical/`, log
`/private/tmp/mergeone-native-upgrade-qa-final-20261020.log`. Les montants, la
provenance appliquée/rechargée et les vrais téléchargements passent, sans retry.
La revue indépendante a fermé l'incompatibilité des ports et ne signale aucun
autre défaut. La qualification de publication finale et la CI de ce lot suivent.


`mise exec node@24.19.0 -- npm run check:release` passe sur le lot final :
**3 333 tests Node**, **820 jsdom**, **12 contrôles critiques**, build de
production, garde du runtime PDF et smoke HTTP. Les trois tests Node déjà
ignorés restent hors preuve. Journal :
`/private/tmp/mergeone-native-upgrade-release-final-20261020.log`.
Les sources applicatives et les contrôles sont revus ; CI et déploiement de ce
nouveau lot restent à confirmer.


## Archives natives PostgreSQL et snapshot CI

La CI `39506092891` de `e0002bc8` échoue à la préparation du snapshot, avant
l'exécution des parcours : « exactly one PostgreSQL client ». Artefact
`12303706635`, SHA256
`ff1c6c8559c04f45a7effc6fe279118437362feda2dc718966c4d94f91d955df`.
Le cache froid 2.121 place les outils dans `version/plateforme/checksum/bin` ;
le détecteur ne cherchait que l'ancien `version/plateforme/bin`. L'ancien format
encore présent sur le Mac masquait cette absence. Il ne s'agit donc pas d'une
preuve de plusieurs clients actifs : le premier message était ambigu.

Avant correction, deux régressions de fichiers réels sont rouges : archive
froide introuvable et archive incomplète masquée par le vieux répertoire. Le
résolveur commun préfère maintenant le chemin à checksum, exige un unique
candidat et des exécutables complets, refuse toute ambiguïté et inscrit le
checksum dans l'identité du snapshot. Les trois recettes psql réutilisent ce
même résolveur. Les huit tests du snapshot passent. Qualification prévue :
IO01 + LOCK01 avec création réelle d'un snapshot, puis LOCK01 avec restauration
et contrôles de catalogue/données. Aucun nettoyage de cache utilisateur n'est
nécessaire et aucun résultat métier n'est revendiqué pour la CI bloquée.


## Coupure de connexion après rendu CPU

La création de snapshot passe avec Node 24.19.0 (IO01 + LOCK01 3/3, CSV 223 ms),
archive `.e2e/army/ci/2026-10-20T22-19-00-493Z-critical/`. Sa restauration réelle
passe ensuite avec Node 24.22.0, le patch actuellement utilisé par GitHub :
catalogue et migrations vérifiés, LOCK01 vert. IO01 reproduit alors localement
la panne PDF : `StorageUnknownError`, `TypeError`, `ECONNRESET`, `fetch_failed`,
après rendu de 311 014 octets. Archive rouge
`.e2e/army/ci/2026-10-20T22-23-01-185Z-critical/`. Le cache n'est pas la panne PDF.

Le reproducer HTTP possédé échoue sous 24.22.0 après six uploads puis 3,5 s de
travail CPU bloquant : la connexion keep-alive est fermée par le serveur sans
que le client ait traité sa fermeture. Le même reproducer passe avec un retour
à la boucle réseau avant l'upload. L'essai antérieur sous 24.19.0 ne reproduisait
pas cette panne. La mise à jour de CLI seule ne constitue donc pas sa correction.

Avant implémentation, régression spécialisée prévue dans le générateur réel :
serveur HTTP dans un worker indépendant, SDK Storage réel, rendu simulant le
blocage CPU puis upload immuable exact et unique. L'E2E IO01 couvre le fichier
réel mais ne contrôle pas précisément la fermeture de socket pendant le rendu ;
ce cas réseau justifie cette isolation. Conserver les assertions de publication,
le refus d'écriture échouée et aucun retry. Le correctif rendra la main aux phases
poll/close avant le premier upload, selon la [boucle Node](https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick).


IO01 + LOCK01 passent après correction sur Node 24.22.0 : **3/3**, vraie
restauration du snapshot, pgTAP et matrice RLS. CSV 1 900/1 900 en 195 ms ; PDF réel
et publication vérifiés. Archive `.e2e/army/ci/2026-10-20T22-26-45-990Z-critical/`,
commande `ARMY_DB_SNAPSHOT_DIR=/private/tmp/mergeone-native-snapshot-20261021 mise exec node@24.22.0 -- npm run e2e:army:local -- --grep 'IO01|LOCK01'`.
Deux nouvelles fins de ligne d'import sont normalisées ensuite, sans changement
exécuté. La revue demande de constater la fermeture TCP, plutôt que la supposer
après 3,5 s. L'oracle utilise maintenant un SharedArrayBuffer écrit par le worker ;
il bloque la boucle cliente jusqu'à fermeture constatée des connexions warm,
avec une borne d'échec de 6 s. Il reste rouge sur l'implémentation originale
(`mergeone-pdf-stale-socket-observed-red-20261021.log`). Le test conserve l'upload
exact et unique et la publication. Aucun retry ajouté. La qualification finale
inclut ce renforcement ; il ne change pas les entrées applicatives du run E2E.


Qualification finale : `mise exec node@24.22.0 -- npm run check:release` **passe**
(3 336 tests Node, 820 jsdom, 12 contrôles critiques, build Webpack, runtime PDF
isolé et smoke HTTP). Les trois tests Node préexistants ignorés restent exclus
de la preuve. Log `/private/tmp/mergeone-pdf-socket-release-final-20261021.log`.
Revue indépendante close après renforcement de l'oracle réseau ; diff-check
propre. À ce stade, la CI du commit final puis sa production restent à vérifier.


## Résumé de structure tronqué au-delà de1 000 lignes

La préparation des contrôles finaux révèle dans le hub du gros dossier la phrase
« 1000 lignes de devis disponibles depuis la DPGF importée. », contre1900 lignes
réelles et exportées. Preuve `large-hub-count-before.json` sur le build bee0163.
`fetchAffaireHubSummaryWithContext` lit les fournisseurs de structure sans
pagination : le plafond PostgREST tronque ce résumé et peut aussi masquer les
modes des lignes après la première page. Le nombre global utilise déjà count
exact. Avant correction, IO01 est enrichi d'une assertion visible exacte1900,
sur le même vrai classeur avant la génération PDF. Correctif prévu : lecture
complète par le helper existant, projection avec id et count exact, filtres de
tenant/version conservés. Aucun test isolé supplémentaire ni migration requis.


## Pagination PDF et stabilité du parcours après export

CIc13999f2 : qualité et smoke verts, mais IO01 dépasse encore30s avant le
vrai téléchargement. Artefact12304703428 SHA256
`e0e09c28448de8f69e51adc4df6718ed58b893e53773d78f84bfa0972e99e0fe`.
Cette fois, aucune panne Storage : upload à22:36:52, publication à22:36:56,
signature à22:37:03 après clic à22:36:24. Le correctif TCP a donc passé son
ancienne étape d'échec ; le délai observé reste un défaut à traiter.
Le profil local du vrai document montre les relayouts Yoga et conversions de
styles répétés. Le renderer installé4.9.0 expose `experimentalPagination`
([changelog officiel](https://github.com/diegomura/react-pdf/blob/master/packages/renderer/CHANGELOG.md)),
qui mesure une fois les contenus. Avant adoption, pilote sur le contrat du même
devis : mesurer avant/après, toutes les1900lignes et valeurs, texte/footer de
chaque page, première/dernière page, conditions et titres longs. Conserver le
budget de téléchargement30s ; aucune dépendance n'est mise à jour pour ce pilote.

Le run local avec compteur corrigé passe l'assertion1900 et les deux fichiers,
puis expose un409 dans les paramètres après le téléchargement. L'écran du hub
reste actif et `router.refresh()` est encore déclenché par le succès PDF, alors
que le test reprend un verrou API : l'exclusivité de page doit rester protégée.
Le parcours quittera explicitement cet écran avant ses écritures API suivantes ;
un code d'erreur fermé sera retenu si une assertion échoue. Run
`.e2e/army/ci/2026-10-20T22-39-53-908Z-critical/`, conservé comme échec partiel.
Le lancement prématuré22-39-11 a été interrompu avant correction, hors preuve.



Pilote sur le même contrat de2031items : nouveau moteur seul792ms,71pages,
1900lignes et tousPU/HT/statuts/totaux exacts. Une première lecture de capture
suggérait un footer masqué. Les coordonnées et pixels contredisent cette lecture :
ancien et simple opt-in ont le SIRET à812,34pt et1712pixels d'encre dans la même
bande basse. Aucun rouge d'occlusion n'est établi. La revue indépendante le
confirme. Le gabarit`layout` essayé déplace au contraire les mentions de109,01pt
vers le haut : il est rejeté, malgré ses tests textuels verts. Le simple
`experimentalPagination` est retenu sur les trois pages, sans changer le chrome.
La sonde canvas/PDF.js préparée reste hors sources : son vert ne prouve pas le
doute initial. Les preuves visuelles et de contenu du pilote sont conservées.

Comparaison appariée sans logo, même contrat et même Node24.22.0 : ancien7557,5ms
contre simple opt-in792ms (échantillons distincts de la campagne, pas une médiane
WSL). Le dernier rendu apparié1087ms utilisait le template rejeté et ne mesure
pas le correctif final. La limite de téléchargement30s reste inchangée.

Le run candidat avec template passe IO01 **2/2 avec connexion**, snapshot
restauré, pgTAP et RLS : compteur1900, CSV1900/1900 en178ms, PDF réel311413octets
reçu en6217ms, repricing et lectures successives verts après sortie du hub.
Archive `.e2e/army/ci/2026-10-20T22-48-48-374Z-critical/`. Son check:release est
également vert (`mergeone-large-pagination-release-final-20261021.log`), mais
ces preuves PDF sont invalidées par le retrait du template. Les assertions du
compteur et du transfert d'acteur restent pertinentes sur leurs sources inchangées.
Le candidat final simple opt-in est requalifié avant son push.


Candidat final simple opt-in : IO01 **2/2 avec connexion**, sur Node24.22.0,
avec snapshot restauré, pgTAP et RLS. Archive canonique
`.e2e/army/ci/2026-10-20T22-52-58-459Z-critical/` : compteur1900, CSV185ms,
PDF réel310971octets téléchargé en4693ms, repricing et lectures successives
passés. Le refus de préparation depuis le checkout racine contenant des fichiers
d'environnement reste hors preuve ; la qualification utilise la copie propre.
La revue indépendante du diff stable ne relève aucun défaut actionnable.


`mise exec node@24.22.0 -- npm run check:release` passe sur les sources finales
simples : 3336tests Node,820jsdom,12contrôles critiques, build Webpack, contrôle
réel des12polices et smokeHTTP. Journal
`/private/tmp/mergeone-large-simple-pagination-release-final-20261021.log`.
Dernier échantillon apparié simple806,3ms, contre7557,5ms pour le même contrat
sans opt-in et le même runtime ; 71pages et310971octets du vrai parcours local
restent distingués du pilote sans logo. Aucun timeout, retry, formule ou
contrat d'autorisation ne change. Revue close, diff-check propre.
