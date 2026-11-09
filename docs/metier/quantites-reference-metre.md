# Quantités de référence et métré

Décisions métier validées par le propriétaire le 8 novembre 2026 pour
[TI-680](https://linear.app/ti-max/issue/TI-680/metre-l3-surface-imprimee-ou-mesuree-selon-la-base-de-la-ligne-de-prix).
Ce document décrit le contrat métier de l'implémentation TI-680. Les résultats de
qualification et l'état de livraison sont à vérifier séparément ; ce contrat
ne constitue pas une preuve de déploiement.

## Quantité chiffrée et provenance

Pour deux quantités comparables, retenir la valeur supérieure pour protéger le
chiffreur, quelle que soit sa source. Conserver séparément :

- la quantité de référence, notamment celle de la DPGF fournie ;
- la quantité trouvée sur les plans, indépendante de la quantité chiffrée ;
- la quantité retenue pour chiffrer ;
- l'écart et son état de vérification.

Une quantité corrigée ou retenue pour chiffrer ne remplace jamais la mesure
originelle dans le contrôle. L'écart doit rester visible après application au
devis, y compris lorsque la référence est la plus élevée.

| Référence DPGF | Métré | Quantité à chiffrer | Écart à conserver | Vérification quantitative |
| --- | --- | --- | --- | --- |
| 3 000 m | 3 020 m | 3 020 m | 20 m, soit 0,667 % | Non exigée par ce seuil |
| 3 000 m | 2 980 m | 3 000 m | 20 m, soit 0,667 % | Non exigée par ce seuil |
| 3 000 m | 3 060 m | 3 060 m proposée | 60 m, soit 2 % | Exigée avant de retenir la proposition |

Les autres contrôles restent applicables : un faible écart n'autorise pas une
mesure dont l'échelle, la base ou le rattachement ne sont pas fiables.

## Échelle du contrôle et cumul

Le seuil de vérification est **strictement supérieur à 1 %**. Il s'applique aux
écarts cumulés sur la même ligne de devis, à unité, matériau et diamètre
identiques pour les réseaux. Le total de l'affaire ou d'un autre réseau ne peut
pas diluer un écart de cette ligne.

Lorsque plusieurs paires de quantités de référence et mesurées sont connues pour
la ligne, additionner leurs écarts absolus, sans compensation entre écarts
positifs et négatifs. Rapporter ce cumul à la quantité totale de référence de la
ligne, avant tout arrondi d'affichage. Lorsque seule une référence DPGF totale
existe, comparer ce total au métré total ; ne pas inventer une ventilation de la
référence par tronçon.

- Un écart de 3 cm sur un tronçon de 20 cm représente seulement 0,001 % d'une
  ligne de 3 000 m : il ne déclenche pas à lui seul de vérification.
- Deux mille écarts de 3 cm sur cette même ligne représentent 60 m, soit 2 % :
  une vérification est exigée.
- Deux références de 50 m et deux mesures de 51 m et 49 m donnent des totaux
  identiques, mais un écart cumulé de 2 m sur 100 m : une vérification est exigée.

La proposition antérieure `max(2 %, 0,1 m²)` est remplacée par ce contrat dans la
règle `area_printed`, version 2 puis version 3 (TI-686, qui ajoute la base attendue par la
ligne de prix au résultat). Le contrôle distinct du
chevauchement géométrique des pièces conserve son propre contrat.

## Bases des surfaces

- Pour les ouvrages au sol, notamment chape et revêtement, la base par défaut
  est le **sol net à exécuter**, sauf indication explicite de la ligne.
- La **SHAB** s'utilise seulement lorsque la ligne de prix la demande
  explicitement.
- Le **plancher chauffant est exclu du périmètre de TI-680**. Aucune convention
  propre à cet ouvrage n'est validée ici et son étude n'est pas un préalable
  à la clôture du ticket. Une même zone peut alimenter des prestations de sol
  et de chauffage dont les périmètres diffèrent.

La base par défaut de la prestation ne prouve pas celle de l'étiquette du plan.
Avant de comparer une surface imprimée et une surface mesurée, vérifier la même
base, le même périmètre et le bon indice, ainsi que l'échelle de la mesure.
Une annotation « 20 m² » dont la base est inconnue reste à vérifier ; recopier
20 m² dans la quantité chiffrée ne résout pas cette inconnue. Une surface SHAB
ne se compare pas automatiquement à un contour mesuré en sol net.

Sans seconde quantité comparable, produire le métré et sa provenance : la règle
du maximum et le seuil d'écart ne peuvent pas être appliqués artificiellement.

## Application et contrôles

Les preuves de qualification doivent
couvrir la quantité effectivement appliquée au devis, sa persistance, la
conservation de la référence et de la mesure, les deux sens du maximum, le cumul
sans compensation, le seuil de 1 % et le refus des comparaisons de bases ou de
lignes différentes. La simple suggestion de la valeur supérieure dans la revue
ne suffit pas si l'application SQL utilise encore une autre quantité.

L'acceptation d'un échec de surface exige, depuis TI-686 (D9), un motif codé, la base
reconnue à la surface écrite et une note ; elle est journalisée avec les clés des échecs
acquittés. Quand cette base est celle de la ligne de prix, les deux surfaces se comparent
et la plus élevée est retenue : l'acceptation exige une quantité au moins égale à la
surface écrite, relevée avant l'acceptation. Sinon, la quantité reste celle de la ligne
(voir « Aire du polygone cohérente avec la surface imprimée » dans les
[règles actuelles du métré](regles-metre.md)).
Voir les [règles actuelles du métré](regles-metre.md) et la
[lecture vectorielle](lecture-vectorielle.md) pour le comportement du code
existant. Une migration locale validée ne prouve pas son application sur la base
partagée, ni le déploiement de l'application.
