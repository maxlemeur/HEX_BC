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
