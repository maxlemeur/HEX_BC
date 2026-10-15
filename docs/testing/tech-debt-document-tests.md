# Fiabilité des tests documents et commandes — diagnostic avant correction

## Périmètre et rouge conservé

Les cinq suites concernées totalisent 23 échecs préexistants : génération PDF
(15), route PDF (1), export XLSX (1), liste des lignes de commandes (2), ZIP
d'une commande (4). Le rejeu avant lot dans
`.codex-tmp/debt-lot1-20261015/before-validation-elevated.log` les reproduit avec
les mêmes identités et premiers messages d'erreur. Les cinq sources propres
avant intervention sont copiées et hachées dans
`.codex-tmp/debt-lot1-20261015/document-tests-before/manifest.json`.

## Défaillances observables et preuves attendues

- Une génération PDF doit vérifier que la révision lue n'a pas changé, publier
  contre sa réservation, conserver les CGV, utiliser le chemin tenant canonique
  et signaler les échecs de stockage. Les doubles actuels ne comprennent pas
  `abortSignal`, le verrou de page ou l'identité figée de l'envoi : ils échouent
  avant ces assertions. Les fournir ne doit neutraliser aucun contrôle produit.
- Le lancement manuel doit transmettre la session de verrou à la préparation.
  Le test de route attend encore l'ancien appel sans second argument.
- L'export d'un devis émis doit conserver son montant contractuel. La fixture
  XLSX est `sent` mais attend un recalcul avec le taux courant de main-d'œuvre
  (161,28 EUR contre les 158,40 EUR persistés). Distinguer explicitement le
  brouillon recalculable de l'émis ; ne pas modifier le moteur pour cette attente.
- La lecture des lignes de commandes utilise désormais le RPC atomique
  `get_purchase_order_documents`, avec en-têtes et lignes cohérents. Les tests
  simulent seulement l'ancienne sélection `purchase_order_items`, d'où 500.
- Le ZIP requiert une projection complète, sa révision et le nombre exact de
  lignes. Les fixtures manquent cette preuve et reçoivent 409 ; les assertions
  ZIP lisent alors le JSON d'erreur comme une archive. Après mise à jour des
  fixtures, conserver la décompression réelle, le contenu HTML, les pièces
  jointes, les noms uniques et la tolérance à une pièce indisponible.

## E2E et exception d'isolation

Scénarios TesterArmy à qualifier : créer un devis, sauvegarder les montants,
générer puis télécharger son PDF ; pour une offre émise, comparer les montants
et le document contractuel après changement des références de catalogue ; créer
une commande avec quantité décimale et pièces jointes, télécharger le ZIP et
l'export depuis la liste, puis comparer en-têtes, lignes, unités et totaux à la
commande persistée. Les campagnes sont coordonnées par l'agent principal.

Les isolations existantes restent utiles pour les refus à la frontière du
stockage, une publication supplantée, un document en cache forgé ou périmé et une
pièce jointe indisponible : ces fautes ne sont pas injectables de façon sûre et
répétable par un parcours navigateur ordinaire. Elles vérifient des sorties ou
des refus métier. Les doubles doivent reproduire les contrats de lecture actuels,
pas remplacer les garde-fous par des réponses permissives.

Aucun changement produit, SQL ou arrondi n'est prévu à ce stade. Une nouvelle
défaillance réelle découverte après remise à niveau des fixtures devra être
documentée et reproduite avant sa correction. Un test isolé vert ne constitue
pas une qualification E2E, SQL ou de mise en service.

## Deuxième niveau du diagnostic

Après rétablissement des lectures, 61/65 cas passent. Les quatre échecs restants
inspectent la sérialisation des éléments React avant exécution des sous-composants :
elle omet le titre de `PdfLimits`, inclut les CGV stockées dans les propriétés
d'un composant même si l'annexe est masquée et attend une ancienne map de prix.
Les assertions de titre/annexe doivent porter sur le rendu des composants ; les
prix figés doivent être vérifiés dans le contrat commercial réellement publié,
avec quantité, prix unitaire, HT, TVA et TTC exacts. Le PDF binaire reste qualifié
par la suite existante `offer-commercial-render.test.tsx` et le parcours E2E.

## Résultat de la correction des fixtures

Les cinq suites ciblées passent : **65/65 tests**, dont les deux statuts de
l'export XLSX explicitement séparés (brouillon recalculé, émis conservé).
Commande : `npm test -- --project=node src/lib/estimates/pdf-generator.test.ts
src/app/api/estimates/[versionId]/pdf/route.test.ts src/lib/estimates/export-stream.test.ts
src/app/api/orders/route.test.ts src/app/api/purchase-orders/[id]/zip/route.test.ts`.
Journal : `.codex-tmp/debt-lot1-20261015/document-tests-green-native-final.log`.
Le lint ciblé passe. La tentative sandbox précédente a échoué avec EPERM avant
collecte ; le même rejeu local hors sandbox fournit la preuve comportementale.

La correction porte uniquement sur ces cinq fichiers de tests et cette note.
Le contrat de publication vérifie aussi l'identité réservée de l'offre et les
montants figés exacts ; les limites de prestation et l'absence d'annexe CGV sont
vérifiées après exécution des sous-composants React. Aucun garde-fou, code produit,
calcul ou schéma n'a été changé. Qualification E2E suivie par la campagne principale.
