# TI-534 — recette du K FO unique et des kits métier

Responsable métier : Maxime. Utiliser une affaire fictive et un **nouveau brouillon moteur 3**.
Les valeurs ci-dessous supposent des bases entreprise non personnalisées, aucune
préférence utilisateur, aucune remise ni arrondi commercial. Ne pas modifier un devis client
pour cette recette.

## 1. Coefficient et aide

Dans le chiffrage, afficher Type FO, prix d’achat, K FO et prix de vente.
Créer un tube : quantité **101 m**, prix d’achat **100 €**, main-d’œuvre **0**,
coefficient de vente fourniture **1,30**. Sélectionner le Type FO **Tube**.

| Action | K FO attendu | PU de vente HT | Total HT pour 101 m |
| --- | ---: | ---: | ---: |
| Nouvelle ligne automatique | 1,13 | 146,90 € | 14 836,90 € |
| Saisir 1,017 dans K FO | 1,017 | 132,21 € | 13 353,21 € |
| Saisir 1,0735 dans K FO | 1,0735 | 139,56 € | 14 095,56 € |

Enregistrer, rouvrir et vérifier la dernière valeur, sans multiplication supplémentaire.
Il n’y a qu’une colonne de coefficient fourniture. Dans **Aide colonnes** et l’aide
de K FO, vérifier la mention des **pertes, du transport, du volume acheté et des autres
éléments prévus par l’utilisateur**. La main-d’œuvre reste indépendante.

Créer séparément un raccord ou un calorifuge : sa base automatique est **1,02**.
Le supplément de pertes des tubes ne doit pas s’y appliquer.
Une quantité métrée de 100,40 m arrondie à 101 m donne 111,10 m en interne avec
10 % de pertes ; la quantité facturée reste 101 m.

## 2. Bases entreprise, préférence et brouillon

Dans **Profil → Coefficients fourniture K FO** :

1. Un administrateur peut modifier la base entreprise (jusqu’à six décimales, par exemple 1,0735 ou 0,95) ; un autre membre ne peut pas le faire.
2. Saisir une préférence personnelle Tube de **1,15**, puis enregistrer.
3. Revenir dans un brouillon appartenant à cet utilisateur. Cliquer sur
   **Actualiser les K FO automatiques**, puis enregistrer (Ctrl/Cmd+S). Une ligne automatique Tube passe à **1,15**.
4. Saisir manuellement **1** sur une autre ligne. Refaire l’actualisation : elle reste à **1**.
5. Changer sa famille : son choix manuel reste conservé. Copier un K FO avec Ctrl+D
   vers une autre famille copie la valeur visible comme un choix manuel.
6. Revenir dans le profil et vider la préférence pour reprendre la base entreprise.

Une modification de préférence seule ne réécrit pas les lignes déjà enregistrées.
Les modifications ordinaires de quantité ou de titre ne changent pas leur K FO ;
l’actualisation explicite applique la nouvelle base. Dans une affaire partagée,
la préférence utilisée est celle du **propriétaire de l’affaire**.
Les anciennes lignes dont le mode automatique/manuel n’a pas été enregistré
sont conservées par prudence et exclues de l’actualisation.

## 3. Kit métier et document client

Insérer un assemblage de bibliothèque contenant des composants de familles différentes.
Il devient un kit métier : articles et quantités prédéfinies restent enregistrés.
Par exemple, avec 100 € de tube et 30 € de raccord, sans MO, et vente FO 1,30 :
**100 × 1,13 × 1,30 + 30 × 1,02 × 1,30 = 186,68 € HT**.

Vérifier que le chiffrage montre le kit et son total, sans sa décomposition.
Générer puis télécharger réellement le PDF : le titre du kit et **186,68 €**
apparaissent, les désignations des composants restent masquées. Le total général
reste identique. Les exports de données internes conservent les composants.

## 4. Non-régression

Dupliquer le brouillon puis le rouvrir : mêmes valeurs, coefficients et totaux.
Une copie de section conserve le K FO effectif comme choix manuel.
Enregistrer le kit comme modèle, dupliquer ce modèle puis le réinsérer : son
coefficient et le masquage des composants sont conservés.
Les copies ne cumulent pas les frais. Un ancien devis émis/scellé conserve ses
montants et son snapshot. Le transport n’est pas ajouté comme poste client.
Le cas rare d’un prix fournisseur incluant le transport conserve sa provenance.
Sur les bases standard connues, le transport déjà inclus est retiré de la base.
Les coefficients personnalisés restent ceux choisis par l’utilisateur.

## 5. POSE SEULE et exemples de Maxime (après intégration TI-539/TI-541)

Le nom **K FO** reste inchangé. Dans le profil, modifier la base Tube de
1,13 à 1,20 : une ligne Tube automatique actualisée doit prendre 1,20.
Le calcul ne doit pas imposer 1,13 après ce changement.

Sur une ligne `pose_only`, même associée à la famille Tube ou comportant du
supportage, vérifier **K FO = 1** par défaut. Une actualisation automatique
la garde à 1. Choisir manuellement 1,05 : enregistrer, rouvrir et actualiser ;
ce choix doit rester 1,05. Seule la fourniture est ajustée, pas la MO.

Avec les bases initiales, vérifier ces montants **avant marge** :

| Exemple | Base | K FO | Montant attendu |
| --- | ---: | ---: | ---: |
| Tube fonte Ø100 | 142,43 € | 1,13 | 160,95 € |
| Robinet DN 25 | 58,43 € | 1,02 | 59,60 € |
| Pose seule WC | 175,50 € | 1 | 175,50 € |

TI-534 intègre `origin/main` contenant TI-539 et TI-541 (base `0a5f58e5`). La
migration unifiée est postérieure à celle de TI-541 et conserve sa provenance
`site` et sa règle POSE SEULE. Le sélecteur v3 propose trois choix, sans « Pose » simple ; le choix explicite
« POSE SEULE » ajoute cette mention après la désignation dans le devis.
Les tests isolés de calcul ne remplacent pas la recette de persistance et d’interface.

## Qualification automatisée

Les parcours FO53401/02 protègent les sélections de prix et leur provenance.
FO53410/11/12/13/14/15/16 couvrent le coefficient unique, sa précision, les préférences,
le choix manuel, les écritures API, les anciens brouillons, le PDF du kit et la conservation de POSE SEULE/coût chantier après copie et création depuis un modèle. Depuis un checkout sans `.env`, avec les
dépendances de `.nvmrc` et les prérequis du
[guide local](tester-army-local-development.md) :

```sh
npm run e2e:army:local -- --grep 'FO534'
```

Le runner crée et détruit sa propre base. Une exécution dans la boucle de
développement ne remplace pas la qualification finale. La migration locale et
le code doivent être livrés ensemble. Le déploiement et l’application de la
migration sur la base partagée nécessitent l’autorisation explicite du propriétaire.
