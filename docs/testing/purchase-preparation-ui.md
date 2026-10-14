# Préparation des achats : revue et reprise dans l’interface

Cadrage du 11 octobre 2026, avant modification de l’interface SITE-01A.
Le contrat métier est décrit dans
[purchase-preparation-next-slice.md](../product/purchase-preparation-next-slice.md).
Ce document définit les comportements à vérifier ; il ne constitue pas un
résultat de recette.

## Défaillances observables

- Une sélection peut contenir plus de cinq lignes alors que l’interface actuelle
  masque les suivantes ; une création ne doit pas demander de confirmer des
  montants ou des lignes impossibles à relire.
- L’étiquette de quantité « u » peut déformer une quantité exprimée en mètres.
- Une création sur un ancien aperçu peut reprendre des données jamais relues.
  Un conflit doit empêcher une nouvelle création jusqu’à la recharge et à une
  nouvelle confirmation humaine.
- Deux événements de validation avant le prochain rendu, une erreur réseau ou
  une réponse perdue peuvent lancer plusieurs préparations. La même intention
  doit rester stable pendant la reprise, avec sa requête initiale inchangée.
- Un rechargement peut perdre le résultat d’une demande pourtant enregistrée.
  Il faut retrouver son reçu avant de proposer une autre création ; charger
  l’écran ne doit jamais déclencher un POST de création.
- Une erreur lors de la relecture suivant un succès peut cacher les commandes
  créées. Le reçu et ses liens doivent rester consultables indépendamment de
  la préparation courante.
- Une commande devenue envoyée, confirmée, reçue ou annulée peut disparaître
  du panneau et donner l’impression d’un besoin disponible. Ses rattachements
  et son état doivent rester explicites.
- Une indisponibilité du stockage du navigateur peut faire croire qu’une
  reprise après rechargement est garantie. Cette défaillance doit être traitée
  avant l’envoi de la création.
- Une réponse HTTP 200 vide ou illisible lors de la recherche du reçu ne prouve
  pas son absence. Seule une enveloppe valide contenant explicitement
  `data: null` permet de revenir à une nouvelle revue ; une réponse illisible
  laisse le résultat inconnu et ne doit pas lancer de nouveau POST.

## États attendus

1. **Relecture** : toutes les lignes sélectionnées, unités, quantités, coûts
   négociés unitaires et montants HT/TVA/TTC sont accessibles. La livraison et
   la note font partie de la demande à confirmer.
2. **Envoi** : une clé d’intention est conservée avant le POST. Les champs sont
   verrouillés et une garde immédiate empêche un double événement local.
3. **Résultat inconnu** : la demande reste figée ; une reprise explicite utilise
   la même clé et la même requête. Une autre demande exige d’abord une relecture.
4. **Préparation périmée** : recharge obligatoire puis nouvelle confirmation ;
   aucune nouvelle création sur l’ancien aperçu.
5. **Reçu** : identité des commandes et montants enregistrés restent visibles.
   Une reprise indique qu’il s’agit d’une préparation déjà enregistrée. Les
   montants du reçu ne sont pas présentés comme une proposition actuelle.
6. **Retour sur la page** : une lecture du reçu conservé est tentée ; aucun
   POST automatique. Seuls identifiants de version et clé d’intention sont
   stockés localement, sans note, coordonnées, montant ni jeton de session.

Une modification des groupes, du chantier, de la date ou de la note réinitialise
la confirmation. Une réponse tardive concernant une autre version ne doit pas
remplacer la préparation affichée. Une commande annulée ou supprimée ne permet
aucune recréation automatique dans SITE-01A.

## Recette prévue

TesterArmy porte les interactions et les assertions exactes sur les données
persistées : revue avec plus de cinq lignes, unités et trois totaux ; confirmation
réinitialisée par modification ; création valide ; conflit de préparation ;
double validation ; réponse perdue puis reprise ; rechargement et lecture du
reçu sans nouveau POST ; rattachements de chaque statut ; maintien des liens
quand la relecture échoue. La recette conserve les clés d’intention et les
identifiants de commandes, sans secrets.

Les tests de composant existants seront adaptés avant l’implémentation au
contrat public arrêté. Aucun nouveau test isolé ne remplace cette recette
réelle. Les invariants transactionnels, d’autorisation et de concurrence en
base sont qualifiés séparément dans la recette native de SITE-01A.

## État de l’implémentation locale

Le panneau et le client utilisent le contrat
[purchase-preparation-contract.md](../product/purchase-preparation-contract.md).
La relecture comprend toutes les lignes de chaque groupe, l’unité, le coût
négocié unitaire et les trois totaux. La confirmation est remise à zéro à
chaque modification du chantier, de la date, de la note ou de la sélection.
Les réponses asynchrones sont rattachées à la génération de la vue pour
éviter qu’une ancienne réponse affecte une version visitée ensuite.

La clé `estimate-purchase-intent:v1:<versionId>` contient uniquement
`{versionId,idempotencyKey}`. L’indisponibilité du stockage bloque la demande
avant son émission et l’explique à l’utilisateur. Une demande à résultat
inconnu reste figée en mémoire ; le bouton de reprise cherche d’abord son
reçu, puis ne rejoue la même demande que si le serveur répond explicitement
qu’il ne possède pas de reçu. Au retour sur la page, seule la recherche du
reçu est automatique. Une réponse absente impose une nouvelle confirmation
humaine ; elle ne prétend pas prouver l’absence de toute requête encore en
transit. La protection définitive des lignes reste transactionnelle.

Les liens de commandes ne sont proposés que si `can_open` est vrai ; un
reçu garde ses montants historiques et affiche séparément le statut actuel.
Le reçu reste visible même si la préparation suivante échoue.

Les quatre tests de composant retenus ont été adaptés avant ce code :
quatre échecs attendus sur la confirmation absente, puis quatre succès.
Preuves locales : `.e2e/purchase-ui-work/component-red-clean.json` et
`.e2e/purchase-ui-work/component-green-final.json`. Le typecheck et le lint
des fichiers concernés réussissent. Ces contrôles ne qualifient pas le
parcours connecté ; les résultats TesterArmy et natifs doivent être lus
dans leur recette dédiée.
