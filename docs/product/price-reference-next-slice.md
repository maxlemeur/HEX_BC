# PRICE-02 — Sous-tranche locale du prix de référence

Statut au 11 octobre 2026 : **sous-tranche implémentée et validée localement**. La [recette native et navigateur](../testing/reference-price-e2e.md) a réussi sur le build `OiZfxTcX7ZyRQ0fbNISSs` : authentification et deux scénarios métier, 3/3 exécutés, aucun ignoré, source inchangée pendant le run. Les [régressions SQL](../testing/reference-price-sql.md) et [UI isolées](../testing/reference-price-ui.md) complètent cette preuve. La migration est installée uniquement sur la pile locale de recette ; aucune application distante n'est qualifiée. Cette tranche prolonge TI-535/TI-537 à l'intérieur de [PRICE-02](backlog-chiffrage-2026-10-11.md#price-02--unifier-provenance-validité-et-validation-des-prix), dont les autres critères restent ouverts.

## Décisions et périmètre

La décision utilisateur déjà confirmée est : validité maximale obligatoire de six mois calendaires ; offre fournisseur à zéro exclue du calcul du prix de référence et signalée pour clarification. Une offre à zéro ne représente pas le mode POSE SEULE. Un prix manuel nul justifié reste une décision humaine distincte.

L'oracle retenu pour cette tranche est une **date de fin inclusive**, cohérente avec la contrainte TI-535 et les contrôles de comparaison existants :

| Cas | Résultat attendu |
| --- | --- |
| Début 31/08/2026, fin absente | Fin enregistrée au 28/02/2027 |
| Consultation le 28/02/2027 | Offre encore valable ce jour |
| Consultation le 01/03/2027 | Offre expirée |
| Fin plus courte, égale ou postérieure au début | Acceptée jusqu'à cette fin incluse |
| Fin avant le début ou après le plafond de six mois | Écriture refusée |
| Début absent à la création | Date de création côté serveur |

Comparaison et validation doivent utiliser la même date métier côté serveur. Une fin omise lors d'une modification conserve la valeur existante ; une fin explicitement vidée est recalculée au plafond. Aucun changement de date ne rafraîchit artificiellement une ancienne offre lors d'un backfill.

## Changement réalisé

- `supabase/migrations/20260906110121_supplier_price_validity_six_months.sql` possède déjà le trigger INSERT/UPDATE, le NOT NULL et la contrainte de plage. Création et bulk appellent aussi `resolvePriceValidity`. La contrainte installée localement a été relue ; création, modifications partielles et bulk ont été exercés par les APIs ordinaires.
- La nouvelle migration `20261011030647_reference_price_zero_and_inclusive_validity.sql` retire l'annulation globale de moyenne présente dans la migration TI-537. Elle conserve l'exclusion du zéro ainsi que `zero_price_requires_review=true`.
- La même migration remplace la borne d'expiration `>=` par `>` : le dernier jour est inclus, les fins plus courtes restent respectées. La preuve des anniversaires calendaires exacts est SQL isolée ; les dates calculées ont aussi été relues via l'API native.
- `ProductReferencePricePanel.tsx` affiche la moyenne positive avec une clarification persistante et un lien vers l'offre à corriger. Le cas sans offre comparable conserve et signale la référence antérieure.
- Empreinte, recalcul sous verrou, droits responsables et journal restent dans le contrat existant. Le refus d'une empreinte périmée et la préservation du devis ont été observés localement ; le journal natif conserve auteur exact et trois offres, dont le zéro. La contention entre connexions simultanées n'est pas qualifiée.

La clarification reste visible tant que le tarif nul n'est pas corrigé ou retiré explicitement. Une validation de la moyenne ne fait pas disparaître cette anomalie. La mécanique d'accusé de traitement éventuel doit réutiliser les écrans et l'historique d'offre existants ; pas de nouveau système de décision parallèle.

## Échecs observables définis avant le code

1. **Zéro et moyenne.** Article en mètres, quantité de référence 100, transport identique explicite ; fournisseurs à 10, 11 et 0 €/m. Attendre 1 050 centimes, deux offres retenues et zéro exclu avec clarification visible après rechargement. La référence actuelle reste inchangée avant validation.
2. **Validation et conservation.** Le responsable valide la proposition précise ; relire référence, auteur, date et instantané des trois offres. Un devis préexistant conserve son coût négocié. Un lecteur ne peut valider ni via UI ni par requête directe.
3. **Aucune offre positive.** Seul le zéro subsiste : aucune moyenne, référence antérieure conservée et signalée à actualiser, clarification maintenue. Aucun remplacement automatique par zéro.
4. **Règles TI-537 conservées.** Une offre à 9 €/m dès 1 000 m reste exclue pour 100 m ; une offre admissible par fournisseur ; dispersion 10/11,50 sans alerte, 10/11,51 avec alerte sans exclusion.
5. **Proposition périmée.** Modifier un tarif après aperçu : l'ancienne empreinte est refusée, aucun journal ou prix validé à tort, recalcul nécessaire.
6. **Toutes les écritures.** Saisie, création API, update partiel, `update-offer`, import et SQL local : fin absente normalisée, plafond exact accepté, lendemain du plafond refusé, aucune écriture partielle ni modification de référence validée.
7. **Bornes calendaires.** Relecture persistée de 31/08 → 28/02 et cas bissextile ; fin aujourd'hui admise, fin hier expirée, début demain non applicable. Compléter par une régression SQL locale de l'anniversaire exact : ne pas ajouter d'horloge de test à l'API de production.

Le parcours navigateur doit passer par l'authentification et les APIs ordinaires sur des fixtures ARMY locales. Il doit contrôler les montants persistés, les exclusions, les messages et les écritures effectivement produites. Conserver commande, révision, changements locaux, environnement, identités de fixtures, attendu/réel, rapports et empreintes. Les contraintes PostgreSQL/RLS et les courses non reproductibles par le navigateur ont besoin d'une preuve locale séparée documentée.

## Couverture obtenue et critères restants

Les nouveaux oracles SQL et UI ont été écrits et observés en échec **avant implémentation**, puis réussis. Le script SQL a exécuté 96 assertions, dont les moyennes, quantités, devises, transport, dispersion, empreinte, rôles et devis inchangés ; ses limites PGlite sont explicites. Le navigateur sur Supabase natif a exécuté les cas 1, 3 et 5, la validation administrateur et la conservation du cas 2, ainsi que création/updates/bulk API et dates persistées des cas 6 et 7.

La revue indépendante et les états SQL avant/après confirment la préservation de signature, ACL et modes de sécurité observés ; aucun historique de validation n'a été réécrit par la migration. Restent **non qualifiés par la recette native** : rôles lecteur/ingénieur/autre tenant/anonyme, contention simultanée, formulaire de saisie des dates, téléversement et parsing CSV/XLS/XLSX, et tous les parcours de provenance unifiée. Les contrôles de rôles simulés et les bornes de consultation SQL ne deviennent pas une preuve native par extension. Les [suites d'intégrité catalogue](catalogue-integrity-followups.md) détaillent les risques et scénarios restants, dont `valid_from:null` et la provenance de l'update historique.

PRICE-02 reste partiel : cette preuve locale ne clôt ni ses autres critères ni PRICE-03. Toute application à une base distante conserve son autorisation séparée.
