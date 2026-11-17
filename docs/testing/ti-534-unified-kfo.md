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

1. Dans **Profil → Coefficients fourniture K FO**, vérifier qu’un administrateur
   peut modifier la base entreprise (jusqu’à six décimales, par exemple 1,0735
   ou 0,95) et que ce réglage est réservé aux administrateurs. Rétablir la base
   Tube à **1,13** avant la suite.
2. Créer deux lignes Tube dans un nouveau brouillon v3. Laisser la première à
   **1,13** en automatique. Saisir **1** dans le K FO de la seconde et
   enregistrer (Ctrl/Cmd+S).
3. Dans le profil du propriétaire de l’affaire, saisir **1,15** dans
   **Ma préférence — Tube**, puis enregistrer.
4. Rouvrir le brouillon. Dans **Contrôles → Coefficients K FO**, cliquer sur
   **Actualiser les K FO automatiques** et enregistrer. La ligne automatique
   doit afficher **1,15**, la ligne manuelle **1**. Rouvrir le brouillon et
   vérifier les deux valeurs.
5. Changer la famille de la ligne manuelle et vérifier qu’elle garde **1**.
   Copier un K FO avec Ctrl+D vers une autre famille reprend la valeur
   visible comme un choix manuel.
6. Revenir dans le profil et vider la préférence de test pour reprendre la base entreprise.

Une modification de préférence seule ne réécrit pas les lignes déjà enregistrées.
Les modifications ordinaires de quantité ou de titre ne changent pas leur K FO ;
l’actualisation explicite applique la nouvelle base. Dans une affaire partagée,
la préférence utilisée est celle du **propriétaire de l’affaire**.
Les anciennes lignes dont le mode automatique/manuel n’a pas été enregistré
sont conservées par prudence et exclues de l’actualisation.

## 3. Kit métier et document client

Dans le menu **…** d’une ligne du lot, choisir **Insérer un ouvrage après
cette ligne**. Sélectionner un ouvrage de bibliothèque qui contient des composants
de familles différentes et vérifier le lot et la position indiqués avant l’ajout.
L’aperçu distingue le **coût direct** du **prix cible HT**. Si aucun prix cible
n’est renseigné, le sélecteur affiche **sans prix cible**.

Avec 100 € de tube et 30 € de raccord pour un ouvrage, sans main-d’œuvre et avec
un coefficient de vente FO de 1,30, le montant attendu est
**100 × 1,13 × 1,30 + 30 × 1,02 × 1,30 = 186,68 € HT**.

1. Vérifier la position de la ligne d’ouvrage, sa quantité de **1** et son
   montant de **186,68 € HT**. Le détail est replié à l’insertion.
2. Passer la quantité à **3**. Vérifier **560,04 € HT** sur la ligne et contrôler
   le total du chiffrage. Déplier le détail pour vérifier que les quantités
   des composants ont triplé. Modifier un composant, vérifier le recalcul,
   puis annuler cet essai et remettre la quantité de l’ouvrage à **1**.
3. Enregistrer, rouvrir et vérifier de nouveau le montant de la ligne et le
   pied du chiffrage. Générer et télécharger le PDF client. Il affiche le titre
   de l’ouvrage et **186,68 € HT**. Les désignations des composants sont
   masquées et le total général correspond à celui du chiffrage. Les exports
   de données internes conservent les composants.

## 4. Non-régression

Dupliquer le brouillon puis le rouvrir : mêmes valeurs, coefficients et totaux.
Une copie de section conserve le K FO effectif comme choix manuel.
Enregistrer le kit comme modèle, dupliquer ce modèle puis le réinsérer.
Vérifier la conservation du coefficient et de la composition. Le PDF client
présente l’ouvrage sans le détail de ses composants.
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
FO53410/12/13/14/16 couvrent la précision du coefficient, le calcul et le PDF
du kit, les écritures API, les anciens brouillons et la conservation de
POSE SEULE et du coût chantier dans un modèle.

[FO53411](../../e2e/army/local/engine-v3-unified-kfo.e2e.ts#L165) vérifie sur une
base isolée que l’actualisation enregistre **1,15** sur la ligne automatique et
préserve la saisie manuelle à **1**. La recette métier du 12 novembre 2026 a
confirmé la persistance après réouverture et la cohérence du PDF pour une
saisie manuelle. Le scénario complet de la section 2 reste à vérifier en
recette métier.

[FO53417](../../e2e/army/local/engine-v3-unified-kfo.e2e.ts#L555) vérifie le
libellé **sans prix cible** puis les montants de l’ouvrage inséré dans la ligne,
au pied du chiffrage, après réouverture et dans le PDF. Le parcours
[TI718](../../e2e/army/critical/editable-ouvrage.e2e.ts) vérifie l’insertion depuis
une ligne, la quantité modifiable et l’édition du détail.

Depuis un checkout sans `.env`, avec les dépendances de `.nvmrc` et les
prérequis du [guide local](tester-army-local-development.md), lancer les
parcours TI-534 avec la commande suivante.

```sh
npm run e2e:army:local -- --grep 'FO534'
```

Le runner crée et détruit sa propre base. Une exécution dans la boucle de
développement ne remplace pas la qualification finale. La migration locale et
le code doivent être livrés ensemble. Le déploiement et l’application de la
migration sur la base partagée nécessitent l’autorisation explicite du propriétaire.
