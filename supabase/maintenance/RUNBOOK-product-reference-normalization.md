# Normalisation des références produit

À utiliser pour diagnostiquer des collisions de catalogue ou préparer un
rattrapage explicitement autorisé. La
[migration de référence](../migrations/20260819205115_case_insensitive_product_reference.sql)
crée `reference_normalized` et `designation_normalized` avec trim et minuscules,
sans réécrire les valeurs affichées. L'unicité porte sur
`(tenant_id, reference_normalized)` lorsque la référence normalisée n'est pas nulle.
Les consommateurs actuels sont le [catalogue](../../src/lib/catalogue/)
et le [rapprochement DPGF](../../src/lib/mappings/server.ts).

## Diagnostic

1. Vérifier la cible, son historique et ses colonnes/index actuels. Une migration
   présente dans Git n'est pas une preuve d'application sur ce projet.
2. Exécuter seulement les parties en lecture seule (0, 1 et 1 bis) de
   [product-reference-case-collisions.sql](product-reference-case-collisions.sql) :
   volume, taille, verrous, groupes en collision et commandes dépendantes.
3. Examiner les clés étrangères et dépendances **du schéma courant** avant
   toute fusion. Les requêtes historiques listent pricebooks, catalogue
   fournisseur, lignes de commande et liens DPGF ; ne pas présumer que cette
   liste suffit après de nouvelles migrations.

La migration prend un verrou `ACCESS EXCLUSIVE` sur `products`, avec
`lock_timeout = 5s` et `statement_timeout = 5min`. La durée dépend des données,
de la machine et de sa charge ; les anciennes estimations de vitesse dans
les commentaires du script ne sont pas un budget mesuré. Qualifier sur une
copie possédée représentative avant de choisir la fenêtre distante.

## Intervention autorisée

- Une collision exige une décision métier sur le produit à conserver et ses
  dépendances. La section 2 du SQL est un **modèle de fusion**, pas une commande
  à lancer globalement. Revalider ses hypothèses, sauvegarder et relire les
  effets avant chaque commit. La fusion n'est pas automatiquement réversible.
- Si la migration n'est pas appliquée, suivre [le runbook Supabase](../README.md)
  pour appliquer son contenu exact et vérifier l'historique. Si elle l'est,
  corriger par une nouvelle migration ; ne pas modifier ou rejouer l'ancienne.
- Si le verrou est trop coûteux, concevoir et tester une nouvelle intervention
  compatible. L'ancienne variante qui retirait des instructions du fichier
  appliqué est obsolète : le manifeste et l'historique doivent rester intacts.

Après application, vérifier les colonnes normalisées sur des valeurs non vides,
les index `products_tenant_reference_normalized_key` et
`products_tenant_designation_normalized_idx`, leur validité et l'absence de
l'ancien index `products_tenant_reference_key`. Une référence vide normalisée
à `NULL` est attendue, pas une erreur. Qualifier le refus d'un doublon de casse
et le rapprochement des imports sur des fixtures autorisées.

## Échec et retour arrière

La migration de référence est transactionnelle : un échec SQL doit annuler ses
changements. Relire le catalogue et l'erreur avant toute nouvelle tentative.
Après un commit, ne pas supprimer les colonnes normalisées utilisées par
l'application. Préparer une correction additive, ou une restauration autorisée
compatible avec l'application et les moteurs de calcul déjà présents. Une
sauvegarde PostgreSQL ne restaure pas à elle seule les fichiers Storage.

En cas de collisions métier, de dépendances ambiguës ou d'indisponibilité
inacceptable, transmettre le diagnostic sans données privées au responsable
du catalogue et à l'opérateur de la base avant de poursuivre.
