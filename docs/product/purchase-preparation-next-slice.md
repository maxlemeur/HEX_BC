# Prochaine tranche : préparer les achats une seule fois

Cadrage avant code du 11 octobre 2026, sur `main`, révision de base
`ce5874f54f8202297b74e4ed238e5c48e49d2f1b` avec changements locaux. Il complète
[SITE-01](backlog-chiffrage-2026-10-11.md) et le
[journal de progression](progress-chiffrage-2026-10-11.md).

**Priorité proposée : SITE-01A — une préparation relue produit une seule fois
un ensemble complet de brouillons d'achat.** Cette tranche protège la décision
de l'acheteur, évite les doublons et rend une reprise après incident explicable.
Elle précède l'extension des achats aux quantités décimales.

Ce document résulte d'une lecture ciblée du code et des migrations. Aucun des
nouveaux scénarios ci-dessous n'a été exécuté dans ce cadrage ; aucune correction
de cette tranche n'est déclarée livrée. La recette antérieure d'applicabilité
reste décrite dans [purchase-draft-eligibility.md](../testing/purchase-draft-eligibility.md),
avec ses propres résultats et limites.

## Ce que la lecture établit

| Constat dans les sources actuelles | Conséquence à vérifier en recette |
| --- | --- |
| `createEstimatePurchaseOrderDrafts` prépare les groupes puis réalise plusieurs écritures séparées. Les conditions sont relues avant ces écritures. | Une modification entre la dernière lecture et l'insertion pourrait être acceptée sans nouvelle revue. |
| Les commandes sont créées fournisseur par fournisseur. `rollbackCreatedDraftOrders` tente ensuite des DELETE en cas d'erreur. | Une panne du deuxième groupe peut laisser le premier si la compensation échoue. Le code ne vérifie pas le nombre de lignes supprimées ; une suppression refusée par filtrage RLS sans erreur pourrait laisser une commande. |
| `listDraftedEstimateItemIds` ne recherche que les commandes au statut `draft`. | Après passage à `sent`, `confirmed` ou `received`, une ligne paraît pouvoir redevenir préparable pour sa quantité entière. Défaut déduit du code, encore à reproduire. |
| Le schéma de création reçoit les groupes et identifiants de lignes, sans empreinte de la préparation ni clé d'intention. Le panneau recalcule sa demande à partir des groupes affichés. | Un changement de quantité ou de coût négocié depuis l'aperçu peut être repris au POST sans correspondre aux valeurs relues par l'utilisateur. Deux validations ou une réponse perdue ne disposent pas d'un reçu de reprise explicite. |
| Les quantités non entières sont bloquées ; le schéma historique des lignes d'achat et `replace_purchase_order_draft` utilisent des entiers. `computeLineTotals` multiplie quantité et coût sans arrondir le HT au centime. | Retirer le seul refus des décimales serait insuffisant et pourrait déformer quantités ou montants. |

Sources : [préparation et création](../../src/lib/estimates/purchase-order-drafts.ts),
[schémas API](../../src/lib/estimates/schemas.ts),
[panneau de préparation](../../src/components/affaires/AffaireOrderDraftsPanel.tsx),
[calcul d'achat](../../src/lib/order-calculations.ts),
[schéma initial des commandes](../../supabase/migrations/001_add_job_title_to_profiles.sql),
[écriture transactionnelle d'un brouillon](../../supabase/migrations/20260811231935_transactional_purchase_order_and_estimate_creation.sql).

Ces constats ne prouvent ni incident sur données réelles, ni exploitation
distante, ni échec des protections d'offre émise. Le gel v2 et les protections
de publication PDF existent déjà ; leur qualification demeure un travail
distinct, sans motif établi ici pour les réécrire avant cette tranche achats.

## Contrat métier proposé pour SITE-01A

1. La création correspond aux lignes, quantités, coûts négociés, fournisseurs
   et conditions effectivement relus. Une modification pertinente depuis cet
   aperçu impose une nouvelle revue avant écriture. Le prix courant du
   catalogue ne remplace jamais silencieusement le coût négocié du devis.
2. Une action de préparation crée l'ensemble demandé ou ne crée aucune commande
   ni ligne. Une panne sur le second fournisseur ne laisse pas le premier lot
   persisté. Les liens vers version, lignes et offres sources restent cohérents.
3. Rejouer la même intention après double clic, attente réseau ou perte de réponse
   retrouve les mêmes commandes et leurs identifiants. Une même clé avec une
   sélection différente est refusée. Deux intentions concurrentes portant sur
   les mêmes lignes ne doivent pas produire deux transferts complets.
4. Le passage d'une commande de brouillon à envoyée, confirmée ou reçue ne rend
   pas son besoin disponible pour un nouveau transfert intégral. La préparation
   montre le rattachement existant et permet d'ouvrir la commande correspondante.
5. Une commande annulée reste traçable et doit être distinguée d'un engagement
   actif. Son exclusion des engagements ne vaut pas autorisation de recréer
   automatiquement une commande. Le contrat de reprise explicite reste à fixer
   avant implémentation, comme indiqué plus bas.
6. La tranche conserve le périmètre actuel des quantités entières et des achats
   en EUR. Elle ne tronque ni n'arrondit une quantité décimale pour la faire
   accepter. La limite reste visible et la ligne source inchangée.
7. Le résultat est uniquement un ensemble de **brouillons**. Aucun envoi à un
   fournisseur, confirmation de commande, engagement extérieur, modification
   du devis source ou validation de référence catalogue n'est déclenché par
   cette action.

Le reçu d'une intention déjà réussie doit pouvoir être retrouvé même si la
préparation courante a changé depuis : les lignes viennent précisément d'être
rattachées à des commandes. La réponse doit identifier cet ancien résultat,
sans présenter son montant historique comme une nouvelle proposition actuelle.

## Échecs observables et recettes à écrire avant code

Créer exclusivement de nouvelles fixtures ARMY dans une base isolée, avec
connexion ordinaire et deux fournisseurs actifs. Conserver les données du devis
avant/après, les identifiants de commandes et de lignes, leurs statuts, coûts,
quantités, totaux et provenances. Aucun envoi réel n'est nécessaire.

| Scénario | Résultat attendu |
| --- | --- |
| Préparation valide : fournisseur A, 2 × 1 200 centimes ; B, 3 × 777 centimes ; TVA 20 %. Les tarifs catalogue diffèrent des coûts négociés. | Deux brouillons. A : 2 400 / 480 / 2 880 centimes HT / TVA / TTC ; B : 2 331 / 466 / 2 797 ; ensemble : 4 731 / 946 / 5 677. Les coûts négociés et le devis restent inchangés. |
| Après aperçu, changer une quantité de 2 à 3, puis dans une autre fixture un coût de 1 200 à 1 300 centimes. | Ancienne préparation refusée avec conflit identifiable, aucune commande ; nouvelles valeurs visibles avant nouvelle validation humaine. |
| Rendre l'offre ou son fournisseur inapplicable entre le contrôle et l'écriture. | Refus autoritaire avant création ; aucun lot ni ligne persistés. Reprendre aussi les refus existants : unité, devise, minimum, dates et activité. |
| Provoquer un échec d'écriture des lignes du second fournisseur. | Zéro commande et zéro ligne pour les deux fournisseurs après terminaison, et erreur récupérable visible. |
| Envoyer simultanément deux demandes pour la même intention. | Un seul ensemble de deux commandes ; chaque réponse réussie désigne les mêmes identifiants. |
| Envoyer deux intentions distinctes pour la même sélection, ainsi que deux sélections qui se recouvrent. | Aucun transfert double d'une ligne ; un succès et un conflit explicite pour la sélection concurrente incompatible. |
| Perdre la réponse après persistance, puis rejouer la même intention. | Reçu initial retrouvé ; nombre, identifiants et montants inchangés. Même clé avec contenu différent : refus. |
| Faire passer une commande issue de la préparation à envoyée, confirmée ou reçue dans la fixture locale, sans transmission. | Les lignes concernées ne redeviennent pas préparables intégralement. Leur rattachement demeure visible. Reproduire d'abord le comportement actuel. |
| Annuler une commande puis consulter à nouveau la préparation. | Annulation distinguée des engagements actifs, historique conservé, aucune recréation automatique ; la suite dépend du contrat de reprise PO arrêté avant code. |
| Présenter une version, un site, une offre ou une ligne d'un autre tenant ; utiliser un rôle sans écriture. | Refus, aucune mutation ni information étrangère divulguée. |
| Présenter une quantité de 12,5 dans SITE-01A. | Limite explicite, aucun transfert à 12 ou 13 ; source intacte. Le cas positif appartient à SITE-01B. |

TesterArmy porte les parcours UI/API, les résultats exacts, la reprise et la
persistance. Les courses précisément ordonnancées et la panne du deuxième lot
nécessitent une preuve native sur plusieurs connexions ou une injection de
défaillance strictement locale. Documenter cette exception d'isolation puis
écrire la régression avant l'implémentation : deux `fetch` simultanés ne prouvent
pas à eux seuls toutes les intercalations entre contrôle et écriture. Aucun
point de panne activable en production ne doit être ajouté pour faciliter un test.

Les artefacts enregistreront commande exécutée, révision et changements locaux,
environnement, fixtures, résultats attendus/réels et chemins de preuves, sans
jetons. Une préparation, une simulation ou un scénario ignoré ne vaut pas succès.

## Dépendances et ordre de réalisation

1. Arrêter les décisions PO ci-dessous et reproduire les défauts ciblés, en
   conservant les témoins valides de la recette d'applicabilité existante.
2. Définir le contrat de préparation, de création et de reprise, puis garantir
   en base l'atomicité et les invariants nécessaires sous les droits existants.
   Le choix exact des primitives suit les preuves de concurrence ; ce cadrage
   n'impose pas une nouvelle architecture complète.
3. Adapter API, OpenAPI et panneau pour conserver une intention lors d'un retry,
   imposer la revue d'une préparation modifiée et afficher les commandes retrouvées.
4. Exécuter les recettes natives et E2E, relire les changements et documenter
   les limites avant de considérer SITE-01A vérifié.

Réutiliser le contrôle de rôle de [write-access.ts](../../src/lib/estimates/write-access.ts),
les contrôles d'applicabilité et les liens de provenance existants. La RPC
`replace_purchase_order_draft` est un précédent pour les droits, le verrouillage
et les écritures atomiques d'un brouillon ; elle ne fournit pas à elle seule
la création d'un ensemble multi-fournisseurs. Une version de contenu et une
clé d'idempotence servent des besoins différents et ne doivent pas être confondues.

Les acquis de PRICE-02 et de la provenance catalogue sont à préserver. Les
contrôles FND-04 pertinents doivent accompagner cette tranche ; il n'est pas
nécessaire d'attendre tous les lots documentaires ou paramétriques pour traiter
ce risque. Toute migration restera nouvelle et vérifiée localement ; activation
partagée et publication restent soumises au contrat du dépôt.

## Décisions PO à arrêter avant implémentation

Ces arbitrages peuvent être préparés par le PO avec les scénarios ci-dessus ;
ils ne constituent pas des questions supplémentaires adressées à l'utilisateur.

- **Cycle de vie du besoin transféré.** Retenir `draft`, `sent`, `confirmed` et
  `received` comme rattachements empêchant un second transfert complet. Préciser
  la reprise après suppression d'un brouillon ou annulation, ainsi que la
  réouverture d'une commande annulée : il faut éviter qu'une nouvelle commande
  et l'ancienne réouverte couvrent simultanément le même besoin. La recommandation
  est une reprise explicite avec historique, sans recréation automatique.
- **Périmètre de la revue.** Définir les champs dont le changement invalide
  l'aperçu : quantités, coûts négociés, TVA, unité/devise, sélection et conditions
  d'applicabilité au minimum. Décider si un changement sans effet sur la
  sélection relue doit également imposer une revue ; éviter des conflits inutiles
  tout en protégeant le montant réellement accepté.
- **Quantités et suivi des achats.** SITE-01A transfère une quantité entière
  complète par ligne. Les achats partiels, reliquats, substitutions et modifications
  de quantité dans un brouillon demandent un contrat de suivi explicite ; ne pas
  présenter une simple interdiction des doublons comme leur gestion achevée.
- **Lecture de la préparation.** Distinguer lignes préparables, bloquées par
  conditions, déjà rattachées et rattachées à une commande annulée. Définir les
  compteurs et les actions associés avant de modifier la réponse API : une ligne
  masquée ne doit pas être interprétée comme un besoin disparu.

## SITE-01B distinct : décimales et unités d'achat

Cette tranche devra conserver **12,5 m** depuis le devis jusqu'au brouillon,
à son édition, sa relecture et ses sorties. Définir auparavant la précision
des quantités, l'arrondi HT par ligne au centime, la TVA puis les totaux ;
vérifier la cohérence entre calcul applicatif, RPC et stockage.

L'unité d'origine, l'unité commandée et les conditions fournisseur doivent
rester compréhensibles. Une conversion ou un conditionnement ne se déduit
pas d'une décimale : changement de dimension, quantité minimale, boîte ou
longueur commerciale requièrent leur règle explicite. La qualification doit
couvrir schéma, création, modification, affichage et export d'achat, en
préservant les commandes historiques et le coût négocié du devis. Retirer
uniquement `Number.isInteger` ne satisfait pas ce résultat.
