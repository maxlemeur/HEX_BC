# Glossaire métier

## Nature de ligne

Intention de composition d’une ligne de devis : fournitures seules,
fournitures et main-d’œuvre, ou main-d’œuvre seule. Elle détermine les champs
obligatoires. Si des valeurs saisies contredisent cette nature, elles sont
conservées mais la publication est bloquée jusqu’à correction.

## Moteur de calcul

Contrat qui calcule les montants d’une version de devis, épinglé sur la version
(`calc_engine_version`). Depuis la bascule du lot 2 (sous-lot 2.10b), une
nouvelle version est en moteur 3 ; les moteurs 1 et 2 sont historiques : les
versions qui les portent les gardent, sans conversion.

## Politique de calcul de l’entreprise

Réglage par entreprise qui décide du moteur des nouvelles versions et de leurs
coefficients de vente par défaut. Sans politique, le moteur 3 à 1,30 (FO) et
1,20 (MO) ; une politique 2 explicite, posée par l’équipe avec un motif, garde
le moteur 2 pour cette entreprise.

## Coefficient de vente FO / MO

En moteur 3, multiplicateurs de la version appliqués au déboursé des
fournitures (FO) et à celui de la main-d’œuvre (MO) pour obtenir le prix de
vente. Ils remplacent la marge, le coefficient global et les paliers des
moteurs 1 et 2.

## Arrondi commercial

Ajustement optionnel du montant final. En moteur 3, c’est une remise HT qui
ramène le total HT, après remise, au palier inférieur choisi ; la TVA est
ensuite calculée par taux (P-06, avis de l’expert-comptable requis avant usage
client réel). En moteurs 1 et 2, il est appliqué après le calcul HT et de la
TVA et ne constitue pas de la TVA. Les sorties présentent séparément le TTC
calculé, l’arrondi commercial et le montant final à payer.

## Montant à payer

Montant contractuel final : total HT + TVA comptable + arrondi commercial
(moteurs 1 et 2) ; en moteur 3, HT après remise et arrondi + TVA par taux.

## Seuil d’approbation

Montant HT à partir duquel une validation interne est exigée. Le défaut produit
est de 5 000 € HT, seuil inclus, et l’administrateur peut le modifier dans les
règles d’approbation.

## Article associé

Lien optionnel entre une ligne de devis et un article du catalogue. La ligne
conserve sa désignation et ses montants comme un instantané : une modification
ultérieure de l’article ne réécrit pas automatiquement le devis. Le prix
fournisseur sélectionné reste une décision distincte.

## Langage de la revue de couverture

**Pièce documentaire** :
Document reçu dans une affaire, avec son contenu et son origine. Son classement
ou son nom ne prouve pas à lui seul une prescription technique.
_Éviter_ : preuve, lorsque seule l'association d'un fichier est connue.

**Référence de revue** :
Choix explicite des pièces et de leurs révisions applicables à l'examen d'une
version de devis. Elle exprime ce que le chiffreur a effectivement pris pour référence.
_Éviter_ : dernier fichier, document principal, comme synonymes de ce choix.

**Exigence** :
Prescription issue du dossier qui appelle une prestation sur un périmètre donné.
Elle ne dit pas encore comment cette prestation est traitée dans le chiffrage.
_Éviter_ : hypothèse, alerte, ligne de devis.

**Prestation** :
Travail ou résultat technique attendu. Lorsqu'il est chiffré, il peut mobiliser
plusieurs ressources et être présenté dans une ou plusieurs lignes de l'offre.
_Éviter_ : article, comme équivalent systématique.

**Périmètre métier** :
Partie physique ou fonctionnelle de l'affaire à laquelle s'applique une exigence
ou une prestation, notamment une zone et un réseau identifiés.
_Éviter_ : tout le lot, lorsqu'une zone ou un réseau reste non précisé.

**Preuve localisée** :
Passage ou élément identifiable d'une source qui étaye une affirmation et peut
être consulté pour la contrôler. Une citation non vérifiée reste une citation à vérifier.
_Éviter_ : score de confiance, fichier associé.

**Couverture technique** :
Relation justifiée entre une exigence et le traitement de sa prestation dans
le chiffrage, pour un périmètre métier défini.
_Éviter_ : couverture tarifaire, qui concerne l'offre de prix disponible.

**Décision de couverture** :
Arbitrage humain décrivant comment une exigence est traitée dans la version de
devis examinée. Sa validité dépend des preuves et des prestations effectivement revues.
_Éviter_ : approbation commerciale, conformité certifiée.

**À revérifier** :
État d'une décision dont une dépendance a changé ou n'est plus vérifiable.
Il conserve le traitement précédemment décidé sans le présenter comme encore confirmé.
_Éviter_ : rejetée, oubliée.

**Hypothèse** :
Proposition retenue ou discutée pour poursuivre l'étude lorsqu'une donnée
n'est pas établie. Sa validation ne démontre pas la couverture d'une exigence.
_Éviter_ : exigence confirmée, prestation chiffrée.

## Langage de la préparation des achats

**Ligne préparable** :
Ligne du devis admissible à la préparation d'un achat lors de la lecture
courante, compte tenu de ses conditions et de son absence de transfert antérieur.
_Éviter_ : commandable définitivement, ligne couverte par un tarif.

**Ligne déjà transférée** :
Ligne dont le passage en achat est attesté durablement, même si la commande
correspondante a été annulée ou supprimée.
_Éviter_ : disponible à nouveau, du seul fait de cette annulation ou suppression.

**Ligne à corriger** :
Ligne non transférée dont un blocage actuel empêche la préparation de l'achat.
_Éviter_ : déjà commandée, absence de tarif comme cause systématique.

**Couverture tarifaire** :
Présence d'une offre de prix pour une ligne du devis. Elle ne démontre ni la
couverture d'une exigence technique ni l'admissibilité actuelle à l'achat.
_Éviter_ : couverture technique, ligne préparable.

## Langage de la composition d'ouvrage

**Proposition de composant** :
Ressource suggérée ou saisie pour composer un ouvrage, avec ses quantités,
coûts et éléments d'origine. Sa présence dans la revue ne signifie pas qu'elle est retenue.
_Éviter_ : composant appliqué, pour une proposition encore à arbitrer.

**Composant écarté** :
Proposition conservée dans la revue mais exclue de la composition retenue.
Elle garde son identité et ses sources pour permettre une décision ultérieure.
_Éviter_ : composant supprimé, composant gratuit.

**Composition retenue** :
Ensemble des ressources effectivement choisies pour l'ouvrage et son coût.
Elle exprime aussi leurs heures de main-d'œuvre et leur origine.
_Éviter_ : sous-détail proposé, comme équivalent systématique.

**Rétablissement d'un composant** :
Décision explicite de réintégrer une proposition écartée avec son état d'origine
connu. Lorsque cet état est inconnu, une reprise manuelle est une nouvelle décision.
_Éviter_ : restauration automatique, nouvelle suggestion lorsque l'origine est inconnue.

**Main-d'œuvre à coût nul** :
Ressource de pose retenue dont le coût chiffré est nul, avec des heures de
mobilisation qui peuvent rester positives.
_Éviter_ : absence de main-d'œuvre, offre fournisseur gratuite.

## Langage de l'offre émise

**Offre émise** :
Version commerciale transmise au client, avec les prestations, prix de vente,
identités et conditions qui constituaient cette offre au moment de son émission.
_Éviter_ : brouillon courant, PDF simplement préparé.

**Copie commerciale** :
Ensemble figé des données présentées au client dans une offre émise. Une
modification ultérieure de l'affaire ou de l'émetteur ne change pas cette copie.
_Éviter_ : données actuelles de l'affaire, sous-détail de coûts internes.

**Lien client d'offre** :
Accès autorisé et limité dans le temps à une offre précise, pour la consulter
et exprimer une décision sur cette offre.
_Éviter_ : lien vers l'espace interne du chiffreur, lien vers le dernier brouillon.
