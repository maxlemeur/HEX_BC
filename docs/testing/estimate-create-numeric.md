# CORE-08 — coercition décimale avant calcul

Plan écrit avant le normaliseur. PostgreSQL stocke les quantités, coefficients et heures en `numeric(12,3)`, et la majoration horaire en `numeric(12,4)`. Calculer avant cette coercition peut produire un montant différent de celui qu'une relecture permet de recalculer.

Défaillances : arrondi binaire incorrect à mi-unité (`1.0005`), notation exponentielle, arrondi d'un nombre négatif, dépassement après arrondi, refus abusif d'une valeur encore représentable après arrondi, altération de null ou des champs non numériques. Le calcul doit partir de la représentation décimale du nombre envoyé en JSON ; les égalités s'arrondissent à l'opposé de zéro comme PostgreSQL.

La recette HTTP CORE-08 vérifie le câblage réel avec une quantité à plus de trois décimales et la majoration à plus de quatre. L'exception isolée couvre les frontières et exposants : ces entrées sont généralement interdites par les contrôles métier de l'écran, et répéter chaque frontière dans un parcours navigateur n'établirait pas la parité du convertisseur. La régression isolée est écrite et exécutée rouge avant le normaliseur ; la fixture SQL vérifie les typmods réels et l'arrondi PostgreSQL. Aucun test de source statique ni de simple transfert mocké.
