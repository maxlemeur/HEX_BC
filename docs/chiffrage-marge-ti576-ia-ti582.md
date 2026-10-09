# Marges et veille de l’assistant de chiffrage

## TI-576 — comportement d’interface

La marge fixe utilise le coefficient choisi pour le devis. La marge par tranche
retient le dernier seuil atteint par le coût total HT avant marge, puis applique
son coefficient à l’ensemble des lignes. Le montant n’est pas ventilé en tranches
progressives. Un coefficient plus faible au seuil suivant peut donc diminuer le
prix au franchissement du seuil.

Le barème de l’organisation reste modifiable par un administrateur dans
« Tranches de marge » du paramétrage d’un devis modifiable, même lorsque sa marge
est encore fixe. Les routes existantes vérifient les droits et isolent les données
par organisation. La création ou la modification d’un seuil vide, dupliqué ou
invalide et d’un coefficient vide ou hors limites est refusée par l’interface.
Le barème par défaut du moteur est indiqué comme tel lorsque aucune tranche n’est
configurée. L’assistant de création affiche un exemple illustratif, sans faire
passer les seuils par défaut pour la configuration réellement enregistrée.

Les nouveaux devis n’offrent plus de sélecteur de remise cascade. Les anciennes
remises successives et leur coefficient global sont affichés en lecture seule ;
changer le titre, la TVA ou la marge ne les réinitialise pas. Le moteur, les
snapshots et les règles de rendu des devis figés restent ceux déjà présents :
aucune conversion de remise ou recalculation historique n’est effectuée par ce
changement d’interface.

## TI-582 — périmètre de la veille

L’assistant qui prépare ou reprend un brouillon de devis complet « V0 IA » est
en veille via `isEstimateAiDraftEnabled()`. Son entrée dans le menu du chiffrage
est masquée ; les ouvertures manuelles et automatiques, notamment un ancien lien
`openVersionZero=1`, sont refusées par son contrôleur. Les données existantes et
le code métier sont conservés.

Cette veille ne concerne pas la recherche manuelle du catalogue, la comparaison
et le choix des offres fournisseurs, les règles déterministes FO/MO, ni la
génération d’un ouvrage ponctuel. La reprise du brouillon complet demande un
cadrage des entrées, des propositions et de leur validation humaine avant de
réactiver sa disponibilité.

Les entrées V0 du hub affaire, de la hiérarchie et du cockpit utilisent le même
garde. La page affaire et le chargement du devis ne demandent plus automatiquement
le résumé V0. L’action historique « Ouvrir la V0 » est masquée dans les blocages
de soumission ; le blocage et les validations des données historiques sont
conservés. Les lectures nécessaires à ces validations restent actives.

## Preuves et limites

Les régressions ciblées couvrent les contrôles d’interface, les droits, les
conditions d’ouverture de l’assistant et les calculs historiques. Elles ne
constituent pas une preuve d’exécution sur la base distante. La recette globale
et ses limites sont consignées dans [le bilan des huit tickets](demo-eight-implementation.md).
