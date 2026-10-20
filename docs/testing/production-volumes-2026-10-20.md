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
