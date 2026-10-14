# Couverture des parcours critiques et importants

La demande ajoutée au goal exige des parcours TesterArmy pour les fonctions
critiques et importantes. Cette matrice du 13 octobre distingue présence du
scénario, exécution et qualification. Elle provient des documents ciblés et des
parcours Army ; les archives nommées n'ont pas été entièrement requalifiées.
Les réussites antérieures sont locales et datées, pas une qualification du
code actuel ni de la production.

| Parcours | Preuve locale documentée | Écart à traiter |
| --- | --- | --- |
| Import, saisie, calculs, exports | Fondation `2026-10-11T08-12-11-132Z` : 5/5 ; création canonique `2026-10-12T02-37-27-533Z` : 4/4, deux XLSX | Compléter XLS/XLSX multi-onglets, PDF importé, pose seule et coût manquant. |
| Sauvegarde, reprise, saisie intensive | Batch `2026-10-12T18-46-32-879Z` : 6/6 ; navigation `2026-10-12T19-30-14-423Z` : Auth + NAV01/NAV05 | NAV02–04/06 : transport retardé décrit, encore sans implémentation ni exécution. |
| Ouvrages revus et bibliothèque | Build commun `qr3YmHSeJagCWR0yRcnzZ` : GC12 `2026-10-13T10-50-51-008Z` 5/5, six XLSX et 3 702 contrôles ; NI06 `2026-10-13T11-02-52-336Z` 4/4, seize XLSX et 4 584 contrôles ; AT05 `2026-10-13T10-55-14-930Z` 3/3, huit XLSX et 3 382 contrôles | Décisions, provenance, heures de MO à coût nul, saisies naturelles, reprise parent et totaux après insertion qualifiés localement. Restent récupération partielle/inconnue, idempotence d'insertion, courses de paramètres, propositions initialement incomplètes, chapitre/mobile et matrice complète de rôles. Les trois courses SQL antérieures restent datées et distinctes de deux onglets UI. |
| Référence et couverture CCTP | Calorifuge `2026-10-12T20-39-03-661Z` : 12/12, 26 XLSX | Verticale référence A/B autonome et devis renseigné ; autres familles et extraction exhaustive. L'ancienne verticale A/B 2/2 utilisait un devis vide. |
| Tarifs fournisseur et provenance | Référence `2026-10-11T03-12-39-371Z` : 3/3 ; provenance `2026-10-11T08-12-11-132Z` : 5/5 | Comparaison à périmètre égal, conditionnements, consultation complète. |
| Préparation des achats | Décimales `2026-10-11T10-12-06-762Z` : 10/10 ; compteurs `2026-10-11T10-37-09-137Z` : 4/4 ; préparation `2026-10-11T20-10-32-141Z` : 12/12 | Achats partiels, réceptions quantitatives, PDF téléchargé, idempotence du POST manuel. |
| Droits et confidentialité | GR07 `2026-10-11T22-10-45-175Z` : 2/2 ; certains refus anonymes exécutés | Matrice complète rôles/tenants/Storage/portail/marges. La campagne critique `2026-10-02T18-08-41-701Z` est 9/10 : duplication en échec. |
| Approbation, offre émise, révision | Aucun flow Army complet identifié dans les parcours lus | Coût manquant, pose seule, approbation périmée, snapshot émis immuable, absence de coûts/marges dans la sortie client. Les exports de brouillon ne suffisent pas. |
| Métrés, unités, ouvrages paramétriques, DPGF | Spécialistes Playwright conservés ; pas de flow Army complet identifié | Dimensions, conditionnements, réseaux CVC/plomberie et réconciliation interne/commerciale. |
| Budget chantier, engagé/consommé, apprentissage, exploitation | Aucun flow Army complet identifié | Recette verticale après affaire gagnée, validation du retour chantier, restauration complète, corpus professionnel et mesures du gain humain. |

« Aucun flow identifié » décrit la couverture lue, pas l'absence de code.
Pour reproduire un run, utiliser le chemin exact sous
`.e2e/army/coverage/runs/`, sauf la fondation conservée sous
`.e2e/product-foundation/runs/`. Les limites et qualifications sont détaillées
dans [l'avancement produit](progress-chiffrage-2026-10-11.md) et les contrats
de recette correspondants.

## Ordre après CORE-07

1. Offre émise : OF01/OF02 ensemble, lien portail issu du vrai envoi et copie
   commerciale immuable attachée au PDF ; puis OF03, export client construit
   par projection autorisée. La préparation locale existe, sans recette ni
   implémentation encore qualifiée. Les envois externes restent séparément
   autorisés ; le collecteur de test sera uniquement local.
2. [CORE-06](../testing/editor-navigation-lease.md) : établir les ordres
   retardés par un transport transparent réellement exécuté, puis qualifier
   acquisition, libération, réponse perdue et séparation des documents.
3. [Référence CCTP A/B](../testing/source-reference-vertical.md) : rendre la
   campagne autonome, qualifier les octets PDF et décisions A/B séparément de
   la couverture CCTP, puis l'éprouver sur un devis renseigné.
4. Compléter la finalisation : coûts manquants/pose seule, offres fournisseurs
   éligibles et approbation périmée ; distinguer explicitement remise en taux
   et montant fixe. La remise simple actuelle est persistée en points de base,
   même si son champ UI est exprimé en euros ; AT05 qualifie le taux de 10 %,
   pas un montant fixe de 2 €.

Ces étapes ne limitent pas le goal de l'application complète. La valeur
métier et les défaillances observées continuent à guider les priorités.
