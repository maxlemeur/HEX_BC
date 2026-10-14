# Préparation des achats — contrat du compteur

Cadrage du 11 octobre 2026 avant correction applicative. L'écart observé dans
la recette SITE-01B est documenté dans la note sur les quantités et reliquats.
Ce contrat traite la lecture des états ; il n'introduit pas d'achats partiels.

Une ligne **préparable** est admissible au moment de la lecture canonique de la
préparation. Une ligne **déjà transférée** appartient au registre durable de
préparation, y compris après annulation ou suppression de sa commande. Une
ligne **à corriger** reste non transférée et possède un motif de blocage. La
seule présence d'un prix ne prouve aucun de ces états. Les lignes de fourniture
prises en compte sont celles du contrat existant de préparation ; ce compteur
ne mesure pas la couverture des exigences du CCTP.

Les trois comptes proviennent de `getEstimatePurchaseOrderDraftPreparation`.
La carte serveur abandonne son second calcul de couverture fournisseur. Le
total représente la somme préparables + transférées + à corriger. Des comptes
négatifs, non entiers ou incohérents ne produisent pas une promesse de création.

| État | Condition | Présentation |
| --- | --- | --- |
| ready | Préparables > 0, à corriger = 0 | Préparation disponible, avec confirmation humaine |
| warning | Préparables > 0, à corriger > 0 | Préparation partielle possible ; blocages distincts |
| blocked | Préparables = 0, à corriger > 0 | Voir les blocages |
| prepared | Préparables = 0, à corriger = 0, transférées > 0 | Déjà préparé ; consulter les commandes existantes |
| waiting | Total = 0 | Aucune ligne fournisseur à préparer |
| checking | Une lecture ou actualisation est en cours | Vérification des lignes ; aucun compte affirmé |
| unavailable | Lecture échouée ou réponse incohérente | Préparation indisponible ; aucun compte affirmé |

Les états connus portent `counts` avec `totalSupplierLines`, `draftableLines`,
`transferredLines`, `blockedLines`. Les états checking/unavailable portent
`counts: null` : une lecture manquante n'est jamais traduite par zéro ligne.
Un formateur commun produit par exemple « 3 lignes préparables · 1 ligne déjà
transférée · 0 ligne à corriger. » dans la carte et le panneau.

La préparation du navigateur devient l'autorité de ces deux surfaces après
sa première lecture. Un callback versionné remonte son état au parent commun.
Un reçu confirmé invalide immédiatement l'ancienne disponibilité, conserve
les liens du reçu puis relit la préparation. Un échec de cette relecture
n'autorise pas le réemploi des anciennes quantités. Les réponses d'une ancienne
version sont ignorées. Le rafraîchissement serveur ne doit pas réintroduire
des compteurs plus anciens que l'état client actif.

## Scénarios avant implémentation

1. Quatre lignes fournisseur, dont une déjà transférée : carte et panneau
   affichent 3/1/0. L'ancien affichage « 4 commandables » doit être reproduit.
2. Minimum d'achat de 1 m, quantité de ligne modifiée de 12,5 à 0,5 m : après
   lecture réelle, 2/1/1 et motif explicite. Le coût/source reste celui du devis.
3. Quantité restaurée, confirmation et création des trois lignes : 0/4/0 dans
   les deux surfaces avant puis après rechargement ; aucun second CTA de création.
4. GET de préparation indisponible dans le navigateur : aucun compteur fiable
   ni création accessible, possibilité de relire. Ce scénario n'est pas une
   panne réelle du serveur de rendu et ne doit pas être présenté comme telle.
5. Les parcours SITE-01A de refus, concurrence et récupération continuent de
   passer. Ni une annulation ni une suppression ne rendent une ligne disponible.

Recette primaire : TesterArmy avec compte local ordinaire et fixtures ARMY
neuves, assertions de valeurs et d'absence de double création. Aucun test
unitaire de formateur ajouté ; les tests UI existants sont adaptés avant code
si le contrat interne change. Aucune migration ni activation distante requise.
