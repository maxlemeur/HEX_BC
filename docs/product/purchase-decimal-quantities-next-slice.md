# SITE-01B — Conserver les quantités décimales et les unités jusqu’à l’achat

Cadrage du 11 octobre 2026, sur `main`, base
`ce5874f54f8202297b74e4ed238e5c48e49d2f1b` et changements locaux de SITE-01A.
Lecture des sources uniquement : aucune migration, implémentation ni nouvelle
recette n’a été exécutée pour SITE-01B. Les lignes indiquées localisent l’état
inspecté ; elles peuvent évoluer pendant la qualification du candidat SITE-01A.

**Résultat métier attendu : une ligne de devis à 12,5 m doit rester à 12,5 m
dans sa préparation, sa commande, son édition, sa relecture et chaque sortie.**
Le coût négocié est conservé. Une quantité inférieure à un, comme 0,125 m,
ne devient ni zéro ni une unité. L’utilisateur voit quelle unité porte le
prix et ne doit pas la déduire de la désignation.

Cette tranche prolonge le
[contrat de préparation et de reprise](purchase-preparation-contract.md).
Elle reste en EUR et conserve le transfert intégral d’une ligne. Les achats
partiels, reliquats, réceptions partielles et substitutions nécessitent leur
propre contrat ; accepter une virgule ne constitue pas leur réalisation.

## Écarts établis par les sources

| Frontière | Constat vérifié et preuve | Conséquence pour SITE-01B |
| --- | --- | --- |
| Quantité du devis et conditions fournisseur | Le devis est déjà en `numeric(12,3)` dans `supabase/migrations/001_add_job_title_to_profiles.sql:373` ; le minimum fournisseur utilise la même échelle dans `014_catalogue_pricebook_indices_s4.sql:12`. | Réutiliser une échelle de trois décimales plutôt que créer une précision incompatible entre besoin et offre. |
| Stockage d’achat | `purchase_order_items.quantity` est `integer` et les trois montants sont des centimes entiers, schéma initial, lignes 190–195. Aucune colonne d’unité d’achat n’a été repérée dans les migrations de cette table. | Migrer quantité et unité ensemble ; conserver les montants en centimes entiers. Le type TypeScript `number` ne démontre pas une capacité décimale du stockage. |
| Registre de transfert | `private.estimate_purchase_transfers.quantity` est entier dans le candidat `20261011083209_transactional_estimate_purchase_preparation.sql:47`. Le snapshot de revue contient l’unité et la quantité ; la ligne d’achat insérée ne contient pas d’unité (lignes 454–457). | Préserver la quantité originale dans le registre et rendre l’unité disponible sur la commande, indépendamment de l’existence future du devis, du produit ou du tarif. |
| Préparation depuis devis | `src/lib/estimates/purchase-order-drafts.ts:141` et `:361` refusent les quantités non entières. La RPC candidate refuse `quantity <> trunc(quantity)` puis caste en entier (`202610110832...sql:412` et `:457`). | Le retrait du seul refus TypeScript serait insuffisant ; revue, calcul, transaction et registre doivent évoluer ensemble. |
| Calcul applicatif | `src/lib/order-calculations.ts:26` multiplie directement quantité et coût unitaire. Seule la TVA est arrondie, ligne 27. | Avec 12,5 × 123 centimes, le HT vaut actuellement 1537,5 centimes dans ce calculateur. Définir le HT entier avant la TVA et assurer la même règle en SQL. |
| Création et édition manuelles | `src/app/api/purchase-orders/route.ts:129` et `src/app/api/purchase-orders/[id]/route.ts:194` refusent les décimales. Les deux routes filtrent les lignes invalides avant traitement (`:106` et `:175`). | Contrat commun de quantité ; toute ligne soumise partiellement invalide bloque la demande entière avec un diagnostic. Ne pas la supprimer silencieusement d’une commande contenant aussi des lignes valides. |
| Saisie | `src/components/PurchaseOrderDocument.tsx:482` impose `min=1` et `:488` utilise `parseInt(...) || 1`. Les pages de création et d’édition imposent encore `Math.max(1, Number(value) || 1)` (`new/page.tsx:186`, `[id]/edit/page.tsx:264`). | 12,5 peut être tronqué et 0,125 est ramené à un. Il faut conserver une chaîne de saisie pendant l’édition, accepter le séparateur français et afficher les erreurs sans modifier la valeur. |
| Réécriture transactionnelle | `replace_purchase_order_draft` caste quantité en entier aux lignes 312, 373 et 401 de `20260811231935_transactional_purchase_order_and_estimate_creation.sql`. Elle supprime puis recrée les lignes ; elle retrouve la provenance par égalité des valeurs, dont quantité, référence et prix (lignes 364 et 415–424). | Adapter tous les casts, puis conserver une identité de ligne stable et ses sources. Une modification décimale ne doit pas effacer le lien au devis. |
| Édition et provenance actuelle | `[id]/edit/page.tsx:140` ne charge ni référence article ni produit ; son payload, lignes 358–389, ne les renvoie pas. L’API remplace leur absence par `null`, lignes 168–169, tandis que la RPC exige leur égalité pour récupérer les sources. | Même une sauvegarde de note d’une commande avec référence article peut perdre cette référence et le rattachement courant. Ce défaut préexistant doit être reproduit et corrigé avant de qualifier le passage édition/rechargement des décimales. Le reçu initial de SITE-01A ne répare pas cette projection courante. |
| Lecture des commandes | `src/lib/purchase-orders/list.ts:157`, `[id]/page.tsx:97`, `[id]/print/page.tsx:110` ne projettent aucune unité. `OrderItemData`, `PurchaseOrderDocument.tsx:34`, et `orders-model.ts:26` n’en portent pas. | Étendre stockage, DTO et affichages ; distinguer unité absente de pièce explicitement désignée `u`. |
| Exports | CSV/XLSX exposent quantité et montants mais pas unité : `orders-export.ts:23`, `:88` et `:134`. Le ZIP contient `bon-de-commande.html`, pas un PDF généré, et sa projection omet l’unité (`api/purchase-orders/[id]/zip/route.ts:302`, `:316`). | Exporter quantité numérique et unité dans chaque format réellement disponible. Qualifier séparément l’aperçu d’impression et le fichier PDF imprimé si ce dernier est revendiqué. |
| Imports | L’import unifié accepte les nombres localisés (`src/lib/affaires/import-flow.ts:172`) puis arrondit déjà la quantité à trois décimales (`:403`) ; l’unité mappée devient `description` (`:483`). Aucun import direct de lignes de commande n’a été identifié dans les routes et formulaires d’achat inspectés. | Partir du parcours DPGF existant ; ne pas annoncer un import de commandes absent. Vérifier la chaîne import → devis → achat, notamment la visibilité d’une réduction de précision à l’import. |
| Réception | `PurchaseOrderStatusUpdater.tsx:25` propose « Reçue » ; son enregistrement change uniquement le statut, lignes 54–57. Aucun registre de quantités reçues par ligne n’a été repéré dans les modules et migrations d’achat examinés. | Ne pas assimiler ce statut à une preuve de réception complète ou partielle, ni calculer un reliquat à partir de lui. |

Sources principales : [calcul d’achat](../../src/lib/order-calculations.ts),
[document de commande](../../src/components/PurchaseOrderDocument.tsx),
[édition](../../src/app/dashboard/orders/[id]/edit/page.tsx),
[RPC d’édition](../../supabase/migrations/20260811231935_transactional_purchase_order_and_estimate_creation.sql),
[exports](../../src/app/dashboard/orders/_components/orders-export.ts).

## Invariants proposés avant implémentation

1. **Quantité positive à trois décimales au maximum.** Accepter `12,5`, `12.5`,
   `0,125` et `0.001` en saisie ; normaliser une seule fois à la validation.
   Refuser zéro, négatifs, valeurs non finies, formats ambigus et précision
   excessive avec la ligne concernée. Ne jamais remplacer une valeur vide ou
   invalide par un. L’entrée JSON canonique utilise un nombre décimal, sans
   séparateur de milliers ni chaîne locale.
2. **Migration sans réduction de la plage historique.** Une cible telle que
   `numeric(13,3)` conserve tous les entiers positifs actuellement stockables ;
   `numeric(12,3)` seul réduirait le maximum historique de l’entier 32 bits.
   Conserver au minimum la borne haute historique de 2 147 483 647 pour les
   achats et refuser explicitement les dépassements. La source devis reste
   limitée par son propre `numeric(12,3)`. Les limites monétaires s’appliquent
   aussi : une quantité valide ne rend pas valide un total hors plage.
3. **Centimes exacts, calcul défini dans les deux moteurs.** Pour des montants
   non négatifs : HT de ligne = quantité × coût unitaire en centimes, arrondi
   au centime le plus proche, demi-centime vers le haut ; TVA = HT arrondi ×
   taux en points de base, avec le même arrondi ; TTC = HT + TVA. Les totaux
   commande sont la somme des montants de lignes déjà arrondis. Une arithmétique
   décimale exacte ou par entiers à échelle fixe évite de dépendre d’un produit
   binaire flottant ; vérifier les bornes avant conversion en `number`.
4. **Unité de commande et unité du prix explicites.** Persister l’unité sur la
   ligne d’achat et dans son historique. Conserver le libellé source, l’unité
   retenue et toute normalisation déclarée ; ne pas reconstruire l’unité à
   partir du catalogue courant ni de l’unité actuelle du devis, qui a pu
   changer depuis l’achat. Pour l’historique, utiliser seulement un snapshot
   fiable pris lors de la préparation ; sinon afficher « unité à confirmer »,
   sans lui inventer `u`.
5. **Aucune conversion ou quantité commerciale implicite.** Un besoin en mètres
   ne devient pas un nombre de barres, boîtes ou rouleaux sans longueur ou
   contenu de conditionnement sourcé et validation humaine. De même, passer
   de m à m² ou kg exige les paramètres physiques et leur source. Le minimum
   fournisseur est vérifié dans l’unité applicable ; il ne multiplie pas le
   besoin. Tant que cette règle manque, afficher le blocage et conserver la
   quantité source. Aucun coefficient de conversion n’est proposé ici.
6. **Alias d’unité bornés au contexte.** Le code actuel assimile `ml` à `m`
   après passage en minuscules
   (`src/lib/estimates/supplier-offer-eligibility.ts:4`). Cette convention de
   mètre linéaire ne doit pas devenir une conversion générale : une écriture
   ambiguë telle que `mL` doit être clarifiée avant d’affecter une dimension.
   Le traitement d’alias comme `m²`/`m2` doit être explicite et partagé entre
   aperçu, RPC et sorties, en gardant la source originale.
7. **Identité et origine stables à l’édition.** Sauvegarder la même commande
   sans changement de ligne conserve référence, produit, unité et liens
   source. Une correction de quantité ou de prix conserve l’origine et une
   trace de la modification ; elle ne réécrit pas le reçu initial et ne libère
   pas automatiquement une quantité dans le besoin. La quantité transférée
   initialement et la quantité de commande modifiée doivent rester distinctes.
   Si cette distinction n’est pas encore représentable, bloquer la correction
   concernée avec une explication plutôt que supprimer sa provenance.
8. **Protection transactionnelle inchangée.** Les décimales restent soumises
   à l’aperçu relu, l’idempotence, l’atomicité multi-fournisseurs, la vérification
   des droits et les refus de double transfert de SITE-01A. La commande reste
   un brouillon ; une correction n’entraîne aucun envoi ou engagement externe.

Les tarifs fournisseur à zéro restent exclus du calcul de référence avec
clarification. SITE-01B ne change pas cette décision ni l’expiration maximale
après six mois calendaires. Il ne transforme pas non plus un coût négocié
existant en prix catalogue courant.

## Scénarios préalables et critères d’acceptation

Tous les scénarios ci-dessous sont à écrire puis à exécuter sur de nouvelles
fixtures ARMY isolées. Aucun n’est déclaré réussi dans ce cadrage.

| Parcours ou défaillance | Résultat exact attendu |
| --- | --- |
| Devis à **12,5 m**, coût négocié **123 centimes/m**, TVA 20 %, offre admissible d’un autre prix ; revue puis création, ouverture, édition sans changement, sauvegarde et rechargement. | Quantité 12,5 et unité m à chaque étape. HT **1 538**, TVA **308**, TTC **1 846** centimes. Coût négocié et devis source inchangés ; référence et provenance conservées. |
| Ajouter **0,125 m × 777 centimes**, puis **0,001 m × 500 centimes**, TVA 20 %. | Lignes respectives **97 / 19 / 116** et **1 / 0 / 1** centime(s). Avec la ligne précédente : total **1 636 / 327 / 1 963**. Ni quantité minimale implicite de un, ni arrondi HT seulement au total. |
| Saisir les décimales avec virgule puis point ; effacer un champ ; saisir `0`, `-1`, `0,0001`, un texte ou une valeur hors borne. | Valeur affichée conservée pendant la saisie ; diagnostic précis ; aucune commande/ligne omise ou créée tant qu’une ligne renseignée est invalide. Une ligne d’ajout complètement vierge peut rester distincte d’une ligne invalide. |
| POST et PUT directs, puis RPC directe avec décimales valides, trop de décimales, champ absent, entrée mal typée et total hors plage. | Même contrat numérique à chaque frontière ; erreurs atomiques sans arrondi de quantité par cast ou typemod PostgreSQL. Les nouvelles bornes ne rendent pas illisibles les commandes historiques. |
| Modifier uniquement la note d’un brouillon doté d’une référence et d’une provenance ; puis corriger une quantité selon le contrat d’édition retenu. | Première sauvegarde sans perte d’aucune identité/source. Correction explicitement historisée ou bloquée ; reçu initial intact ; aucun besoin implicitement libéré. |
| Modifier quantité, unité, coût ou minimum fournisseur après la revue et avant validation. | Conflit de préparation ; aucune commande créée. Nouvelle revue humaine requise. Le tarif courant ne remplace jamais le coût négocié. |
| Offre minimum **12,500 m**, besoin **12,499 m**, puis **12,500 m**. | Premier cas bloqué, second admissible si les autres conditions le sont. Comparaison à précision décimale exacte, sans arrondi à 12 ou 13. |
| Devis en m, offre en boîte ou en kg sans règle ; unité vide ; alias ambigu. | Blocage explicite et quantités inchangées. Les équivalences lexicales réellement prises en charge sont vérifiées séparément, sans conversion dimensionnelle inventée. |
| Import CSV à virgule, cellules numériques XLS/XLSX, PDF DPGF généré avec **12,5 m** et **0,125 m**, puis chemin canonique jusqu’à l’achat. | Sources et nombres identiques après mapping, confirmation, devis, revue et achat. Conserver `sourceDocumentId` et `_timax_provenance`. Un import à quatre décimales montre la réduction de précision avant confirmation ; ne pas laisser l’arrondi existant passer pour une conservation exacte. |
| Export CSV, XLSX, HTML du ZIP et page d’impression du même achat. | Quantité et unité présentes par ligne, valeurs et totaux identiques au stockage. XLSX : cellules quantité numériques ; CSV : séparation et décimales réimportables sans conversion en milliers ; HTML/PDF : aucune unité ni décimale masquée ou rognée. |
| Double clic, même intention après réponse perdue/rechargement, deux intentions concurrentes sur une ligne décimale ; erreur d’écriture du deuxième fournisseur. | Mêmes reçus et identifiants en reprise ; aucun double transfert ; zéro création partielle. Quantités exactes dans registre et snapshot privé, même après suppression du brouillon. |
| Acteur sans écriture, autre tenant, commande non modifiable, modification concurrente pendant édition. | Refus sans perte de lignes ni source. Le contrôle de version de la commande empêche d’écraser une correction concurrente relue par un autre utilisateur. |
| Commandes historiques à quantités entières, unité absente, taux zéro et taux différent ; commande annulée ou supprimée. | Totaux historiques inchangés, aucune unité inventée, reçu initial préservé et aucun nouveau transfert automatique. « Reçue » reste un statut, sans quantité livrée fabriquée. |

TesterArmy doit vérifier les parcours réels, valeurs persistées, droits et
fichiers téléchargés. Deux requêtes concurrentes lancées ensemble ne prouvent
pas toutes les intercalations : réutiliser la recette native pour les courses
ordonnées et les pannes transactionnelles. N’ajouter une régression isolée
qu’après documentation d’un échec que les assertions E2E ne peuvent exposer
correctement, puis l’écrire avant l’implémentation.

## Ordre de réalisation proposé

1. **Figer les cas d’acceptation et reproduire les pertes actuelles.** Quantité
   tronquée dans le formulaire, refus explicite des API, HT demi-centime,
   sauvegarde de note perdant la référence/provenance. Inventorier les bornes
   et unités réellement présentes sur les commandes historiques avant migration.
2. **Définir une représentation partagée de quantité et d’unité.** Échelle,
   parsing localisé, format canonique, arrondi et overflow doivent avoir une
   seule sémantique ; étendre les DTO sans dériver l’unité historique d’une
   fiche catalogue mutable. Définir l’identité stable utilisée pour éditer les
   lignes et distinguer origine, état courant et reçu.
3. **Faire évoluer le stockage et les écritures atomiques.** Nouvelle migration,
   registre décimal, unité snapshot, création depuis devis et RPC d’édition.
   Retirer les casts entiers seulement une fois toutes les contraintes
   cohérentes. Contrôler les calculs et les droits directement en base. Le
   POST manuel a encore plusieurs écritures compensées (`api/purchase-orders/route.ts:151–217`) :
   qualifier ou remplacer ce chemin avant de revendiquer la même atomicité
   pour la création manuelle que pour SITE-01A.
4. **Adapter API, calculateur et formulaires ensemble.** Rejeter les lignes
   invalides sans omission, conserver les saisies transitoires, rendre l’unité
   visible, préserver les origines à l’édition et éviter l’écrasement d’une
   correction concurrente. Actualiser OpenAPI, types et projections de liste.
5. **Fermer la chaîne documentaire.** Fiche, liste développée, CSV, XLSX,
   impression et HTML du ZIP doivent restituer les mêmes quantités/unités.
   Passer les imports par le contrat DPGF existant ; ne pas ouvrir une seconde
   filière d’import uniquement pour les achats.
6. **Recette complète de la tranche.** Rejouer décimales, historiques et SITE-01A,
   vérifier les fichiers réellement produits et les preuves de concurrence.
   Documenter les résultats exécutés et les exclusions ; préparer l’activation
   partagée séparément, sans l’appliquer sans autorisation.

Les **conditionnements avec règle sourcée**, **achats partiels/reliquats**,
**réceptions quantitatives** et **rapprochement prévu/engagé/consommé** suivent
avec leur modèle propre. Leurs données doivent pouvoir s’appuyer sur les
quantités et unités fiabilisées ici ; ce cadrage ne les déclare ni présents
ni terminés.
