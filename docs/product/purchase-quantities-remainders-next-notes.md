# SITE-01C — Quantités à commander et reliquats : note de priorité

Recommandation produit du 11 octobre 2026, après qualification SQL locale de
SITE-01B. Ce document propose le prochain lot ; il ne constitue ni une
implémentation, ni une recette, ni une autorisation de migration partagée.
Le [cadrage SITE-01B](purchase-decimal-quantities-next-slice.md) reste le relevé
historique des écarts initiaux.

## Recommandation

Prioriser **la couverture du besoin et les achats partiels** avant les
conversions de conditionnement ou les réceptions quantitatives. Le conducteur
de travaux doit pouvoir voir ce qui est déjà préparé, engagé et encore à
commander, puis répartir un besoin sur plusieurs commandes sans doublon.
La première étape doit rendre les écarts visibles ; elle ne doit pas présenter
un reliquat calculé sur des données qui ne prouvent pas sa quantité.

Aujourd'hui, le reçu et le registre attestent un transfert initial immuable.
La quantité de commande peut ensuite être corrigée et historisée. Cela ne
prouve ni la quantité encore nécessaire au chantier, ni la quantité reçue.
Le registre SITE-01A interdit un nouveau transfert de la même source, même
après annulation ou suppression : le remplacer par une simple somme des
commandes courantes réintroduirait les doublons déjà fermés.

## Quantités et preuves à distinguer

| Quantité | Autorité proposée | Ce qui ne suffit pas |
| --- | --- | --- |
| Besoin d'achat validé | Quantité, unité et version de besoin explicitement validées, reliées à la ligne et à sa source documentaire | La quantité actuelle d'un devis modifié après l'achat ; le seul libellé d'une ligne |
| Quantité réservée en brouillon | Allocation quantitative active créée atomiquement avec la préparation | L'existence d'un ancien reçu, sans tenir compte d'une décision de libération |
| Quantité engagée | Allocation rattachée à une commande validée pour engagement, selon une transition explicite | La présence d'un brouillon ou le seul total monétaire de la commande |
| Quantité reçue | Futur journal de réception par ligne, daté et justifié, corrigé par contre-écriture | Le statut global « reçue », qui ne contient actuellement aucune quantité livrée |
| Quantité restant à commander | Besoin validé moins allocations engagées ; réservation brouillon affichée séparément | Une soustraction entre quantités d'unités différentes ou historiques inconnues |

Exemple d'acceptation proposé : besoin validé **100 m**, engagements **40 m +
30 m**, brouillon réservé **10 m**. L'écran montre **30 m restant à commander**,
dont **10 m déjà préparés**, et **20 m disponibles pour une nouvelle
préparation**. Une preuve de réception de **25 m**, dans un lot ultérieur,
permettrait d'afficher **45 m restant à recevoir** sur les engagements. Le
statut « reçue » actuel ne permet pas d'affirmer ces 25 m.

Si SITE-01B a transféré **12,5 m** puis que la commande est corrigée à
**13,125 m**, montrer l'initial, le courant et l'écart **+0,625 m**, avec la
correction historisée. Ne pas créer automatiquement un besoin supplémentaire,
libérer une réserve ou réécrire le reçu initial. Une unité historique inconnue
reste « à confirmer » et bloque une consolidation quantitative non prouvée.

## Ordre de réalisation proposé

1. **Vue de couverture explicable.** Afficher besoin d'origine, transfert
   initial, commande courante, statut et écarts, avec accès à leurs preuves.
   Tant que l'allocation quantitative n'existe pas, annoncer « couverture à
   rapprocher » plutôt qu'un reliquat certain. Qualifier aussi les sources
   supprimées, unités inconnues et commandes corrigées.
2. **Allocation quantitative persistante.** Introduire une identité stable de
   besoin validé et des allocations à trois décimales, dans une unité connue.
   Préserver les reçus et transferts antérieurs comme preuves ; définir leur
   reprise explicitement, sans inventer d'allocations libérées. Le compteur de
   capacité disponible doit être contrôlé sous verrou au point d'écriture.
3. **Préparation partielle atomique et idempotente.** Choisir une quantité
   inférieure ou égale au disponible, revoir les conditions fournisseur et
   créer allocation plus commande dans la même transaction. Le minimum de
   l'offre s'applique à la quantité réellement achetée. Deux préparations
   concurrentes ne peuvent consommer la même capacité.
4. **Corrections, annulations et libérations explicites.** Une réduction,
   suppression ou annulation propose une décision métier sur la réservation,
   avec motif, acteur, date et quantité. Aucune suppression technique ne libère
   silencieusement le besoin. Une augmentation reprend le contrôle de capacité
   et des conditions ; une surcommande demande une décision explicite.
5. **Réception quantitative dans le lot suivant.** Ajouter les réceptions
   partielles et leurs justificatifs avant de promettre un restant à recevoir,
   puis traiter retours, consommation et rapprochement prévu/engagé/réalisé.
   Les conversions de conditionnement restent conditionnées à une règle
   sourcée et validée ; aucune conversion physique implicite.

## Défaillances à prouver avant code

- Deux acteurs réservent simultanément 60 m sur 100 m : une seule réservation
  réussit, l'autre reçoit le disponible relu sans allocation partielle.
- Réponse perdue après achat partiel : la même intention retrouve exactement
  sa commande et son allocation, sans consommer une seconde fois la capacité.
- Correction à 13,125 m après transfert initial de 12,5 m : le reçu reste
  identique et l'écart reste visible jusqu'à décision de rapprochement.
- Annulation ou suppression : aucune capacité n'est libérée sans décision
  explicite ; après libération autorisée, une reprise ne double pas celle-ci.
- Devis révisé, source supprimée ou unité inconnue : diagnostic explicite,
  preuves historiques conservées, aucun reliquat certain fabriqué.
- Achat partiel inférieur au minimum fournisseur, tarif périmé, autre tenant
  ou écriture tardive sur commande envoyée : refus atomique et traçable.

Critère de fin du lot : un utilisateur peut expliquer chaque quantité du
tableau à partir d'une preuve, préparer le disponible réel et reprendre une
opération interrompue sans double achat. Les montants, unités, sources et
garanties d'édition de SITE-01A/B doivent rester vérifiés dans ces parcours.

## Annexe — Compteur de préparation à rapprocher

La recette locale du 11 octobre 2026, archivée dans
`.e2e/product-foundation/runs/2026-10-11T09-55-14-575Z`, montre un écart de
lecture : **4 lignes couvertes par un tarif, 3 préparables et 1 déjà
transférée**, mais l'introduction annonce « 4 lignes sont déjà commandables »
et la carte « Prêt à commander » affiche également quatre lignes. Le
regroupement proposé contient bien les trois lignes disponibles ; le contrôle
contre un double transfert reste distinct de ce défaut de présentation.

La cause est établie dans `src/lib/affaires/finish-line-server.ts:100-149` :
`computeAffaireOrderReadiness` compte toutes les lignes fournisseur et additionne
`coverage_summary.covered_items` à la ligne 137, sans consulter les transferts.
`src/components/affaires/AffaireOrderDraftsPanel.tsx:666-667` réutilise ce compte
pour son introduction ; `src/components/affaires/AffairePilotagePanel.logic.ts:663-669`
le présente aussi comme nombre de lignes préparables. La préparation
transactionnelle chargée séparément possède pourtant les bons compteurs.
Un simple rechargement ne corrige donc pas cette divergence de sens.

À fermer dans la tranche dédiée à la vue de couverture : utiliser une source
commune pour les lignes **disponibles**, **déjà transférées** et **bloquées**,
et distinguer ces états de la seule couverture tarifaire. La recette préalable
doit reprendre le cas 4/3/1 puis le cas où toutes les lignes ont été transférées :
aucun texte ne doit annoncer de nouvelles lignes commandables. Les commandes
annulées ou supprimées ne libèrent rien automatiquement. Cette annexe constate
l'écart ; aucune correction de ce compteur n'est incluse dans la qualification
SITE-01B en cours.

**Mise à jour après correction ciblée :** le compteur possède désormais son
[contrat propre](purchase-readiness-contract.md) et une
[recette 4/4](../testing/purchase-readiness.md), avec source canonique commune,
transferts distincts, minimum fournisseur réel et pannes de lecture. Ce
résultat ne crée ni besoin validé ni allocation quantitative ; SITE-01C
reste ouvert. La requalification des anciens parcours de reprise et la
priorité suivante sont suivies dans le [journal](progress-chiffrage-2026-10-11.md).
