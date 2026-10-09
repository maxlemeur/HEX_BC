# TI-583 — Catalogues d'articles par métier

Décision du 2 octobre 2026 : préparer dix métiers cibles et commencer par un pilote plomberie. L'ordre ci-dessous est une hypothèse d'adéquation au produit, pas un classement de probabilité d'abonnement. Aucun fichier de prospects ni historique de conversion par métier n'a été fourni.

## Sélection et ordre de traitement

Les capacités déjà présentes (articles unitaires, tarifs fournisseurs, quantités, fournitures/main-d'œuvre, DPGF et devis) servent de base à cette sélection. La nomenclature des domaines vient de la [FFB](https://www.ffbatiment.fr/actualites-batiment/actualite/les-fiches-metiers-du-btp), consultée le 2 octobre 2026. Les [publications CAPEB](https://www.capeb.fr/les-chiffres-de-lartisanat) apportent un contexte sectoriel ; elles ne mesurent pas l'intention d'achat de Miaouffrage. Les propositions d'articles et les arguments produit sont notre analyse.

| Ordre proposé | Corps d'état | Intérêt pour le chiffrage actuel | Articles à cadrer | Point à vérifier avec le métier |
| --- | --- | --- | --- | --- |
| 1 | Plomberie sanitaire | Pilote proche du périmètre hydraulique déjà présent ; comparaison de nombreuses fournitures | Tubes, raccords, vannes, siphons, flexibles | Dimensions, raccordements, conditionnements et unité d'achat |
| 2 | Chauffage | Réutilisation du catalogue de tuyauterie et coefficients FO/MO | Radiateurs, robinets, circulateurs, collecteurs, isolants | Séparer équipement et accessoires ; puissance et compatibilité |
| 3 | Électricité | Articles récurrents et variantes fournisseurs faciles à comparer | Câbles, gaines, disjoncteurs, boîtes, appareillage | Sections, pôles, calibres et différence mètre/rouleau |
| 4 | Ventilation et climatisation | Assemblage de nombreuses références techniques | Gaines, coudes, bouches, grilles, supports | Diamètres, débits, bruit et appareils identifiés |
| 5 | Plâtrerie et isolation intérieure | Fournitures répétées avec quantités par surface | Plaques, rails, montants, bandes, isolants | Dimension des panneaux et conversion pièce/surface |
| 6 | Peinture | Consommables récurrents, conditionnements et prix fournisseurs | Peintures, primaires, enduits, abrasifs | Volume du contenant ; rendement distinct du prix au litre |
| 7 | Carrelage et revêtements de sols | Comparaison de fournitures et quantités par surface | Carreaux, colles, joints, sous-couches, profilés | Surface par boîte, pertes et variation de gamme |
| 8 | Menuiserie et fermetures | Quincaillerie récurrente et offres identifiables | Serrures, paumelles, poignées, profilés, fixations | Le sur-mesure exige une définition d'article spécifique |
| 9 | Couverture et étanchéité | Chiffrage de matériaux, accessoires et surfaces | Tuiles, membranes, gouttières, raccords, fixations | Recouvrements, largeur utile et accessoires compatibles |
| 10 | Maçonnerie | Catalogue de matériaux standard et devis quantitatifs | Blocs, briques, mortiers, armatures, accessoires | Distinguer achat au sac/tonne, volume posé et main-d'œuvre |

Les rangs 2 à 10 doivent être révisés à partir d'entretiens et de devis réels, puis des activations et abonnements. Ne pas les publier comme résultat d'une étude commerciale.

## Pilote plomberie

Fichier : [`catalogues-metiers/plomberie-pilote.csv`](catalogues-metiers/plomberie-pilote.csv), 12 articles unitaires. Les descriptions ont été rédigées pour le pilote, sans copie d'un catalogue fournisseur. Les dimensions définissent les variantes proposées ; leur intérêt et leurs caractéristiques finales doivent être confirmés par un plombier avant diffusion du catalogue de démarrage.

Les références `PIL-PLB-…` sont internes au pilote, pas des références fabricant ou fournisseur. Aucun prix ni fournisseur n'est fourni. Le parseur CSV existant représente une absence de prix par `unit_price_cents = 0` : cette valeur signifie ici **prix manquant à renseigner**, jamais une offre gratuite ou un coût de devis validé.

### Import et validation

1. Ouvrir Produits → Import CSV, sélectionner le fichier et consulter la prévisualisation.
2. Vérifier unités, familles et dimensions avec l'utilisateur pilote. Ne pas confondre la longueur de conditionnement avec l'unité de consultation.
3. Rechercher les références internes dans le catalogue avant import. Le parcours CSV ajoute des articles ; il ne doit pas être utilisé pour écraser des articles ou des prix validés. En cas de référence existante, retirer la ligne du fichier ou utiliser le parcours de modification explicite.
4. Importer uniquement les lignes validées dans un environnement autorisé. Ne pas lancer un import partagé pendant la QA locale sans autorisation.
5. Rattacher des offres réelles et constituer le prix de référence selon TI-536/TI-537. Ne pas remplir les prix à partir d'une estimation sans source.

La génération et l'unicité des références de TI-578 complètent ce parcours, notamment pour les futurs fichiers à référence vide. Le test `trade-starter-catalogue.test.ts` passe le CSV réel dans le parseur de l'application et contrôle unités, identité des articles, doublons et absence de prix ajouté.

## Validation du pilote et maintenance

Avant généralisation, faire relire la liste par au moins un utilisateur métier et vérifier un import prévisualisé puis un devis dans un environnement de test autorisé. Mesurer les articles conservés, les variantes manquantes et le temps nécessaire pour trouver une offre. Chaque article doit conserver sa source, son unité et ses conditions lorsque des offres seront ajoutées.

Responsabilité proposée : l'équipe produit maintient les fichiers, versions et descriptions ; un référent de chaque métier valide le contenu technique ; chaque entreprise reste responsable de ses offres et prix validés. Les responsables nominatifs restent à désigner. Une nouvelle liste passe par prévisualisation et validation ; aucune mise à jour automatique ne modifie les devis ou les prix déjà validés.

Version du pilote : 1. Révision à chaque retour du pilote, puis avant tout élargissement à un autre métier. Conserver l'historique des décisions et changements avec le ticket Linear.

## Limites de preuve

Recette locale du 2 octobre 2026 : le CSV réel a été sélectionné dans Produits →
Import CSV sur le serveur compilé. La prévisualisation reconnaît les douze lignes,
sans rejet, avec le séparateur point-virgule. Le dialogue a été annulé avant
l’import ; aucune écriture d’article n’a été effectuée. Capture conservée dans
`.codex-tmp/demo-eight-20261002-01a07773/plomberie-previsualisation.png`.

La sélection et le pilote sont préparés ; aucun abonnement par métier, validation technique par client, import distant ou usage en production n'est établi par ce document. Ces validations demandent des données et retours externes, distincts de l'implémentation locale.
