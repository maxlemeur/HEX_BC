# Prix de référence — TI-537

## Périmètre préparé

Voir la règle et son historique dans [catalogue-prix.md, section 5](domaines/catalogue-prix.md).

Le prix validé reste dans `products.unit_price_cents`, utilisé par les consommateurs existants. Les offres calculent une proposition sans achat confirmé et sans écriture sur les devis. La quantité et le transport doivent être précisés ; aucune valeur par famille ni conversion n'est ajoutée par hypothèse.

La migration ajoute les conditions de comparaison, l'historique des modifications de tarifs, les validations immuables et les RPC. Elle retire les triggers de remplacement automatique par les achats et protège les changements de référence. La suppression physique d'un article possédant une validation est empêchée par les relations de provenance ; l'archivage reste disponible. Un changement d'unité d'une référence validée n'est pas une conversion automatique et est refusé par la garde.

Les fonctions de calcul sont `security invoker`. La validation utilise une fonction `security definer` étroite pour écrire simultanément le journal en lecture seule et le produit : identité authentifiée, administrateur du tenant actif, produit du même tenant, calcul côté base, empreinte et verrou. Les fonctions internes de journal/verrou sont révoquées aux rôles API et accessibles uniquement par les triggers. Les frontières de rôles des autres parcours catalogue ne sont pas refondues dans ce lot.

## Vérifications

- Tests d'API : paramètres, quantité sans arrondi implicite, justification manuelle, refus d'autorisation.
- Tests du serveur : responsable obligatoire, tenant/produit/version pour les conditions d'offre, empreinte recalculée par PostgreSQL, réponse 503 sans migration.
- Tests du panneau : aucune validation automatique, refus après changement de quantité, alerte 15 %, justification, lecture seule, état d'erreur non actionnable.
- Exécution des vraies migrations sur un PostgreSQL isolé (PGlite) avec une fixture de tables et rôles : moyenne, paliers, limites, dates, unités, devises, récence par fournisseur, validation, concurrence logique par empreinte, auteur, absence de recalcul par achat, coûts des devis inchangés, refus inter-tenant/rôle/tenant inactif.

Le script ne reçoit aucune URL de base et crée toujours une instance en mémoire. Pour le lancer avec une installation existante de `@electric-sql/pglite` :

```powershell
$env:PGLITE_MODULE = 'C:\chemin\node_modules\@electric-sql\pglite\dist\index.js'
node scripts/test-reference-price-sql.mjs
```

Sinon le script cherche ce paquet dans la résolution Node habituelle. La fixture `src/test/fixtures/reference-price.sql` est exclusivement destinée à une base jetable ; ne jamais l'exécuter sur Supabase partagé.

Cette exécution ne remplace pas la matrice complète RLS sur Supabase : Docker est indisponible sur cet hôte. La fixture reproduit les frontières nécessaires aux tests ; elle ne prouve pas toutes les politiques du schéma complet. La sérialisation de sessions simultanées doit encore être contrôlée sur une instance PostgreSQL multiconnexion.

## Activation et recette

Activation TI-537 effectuée le 6 septembre 2026 sur le projet Supabase `ijropnynpwjbllievrip`, après autorisation explicite. Historique distant : version `20260906205551`, nom `20260906145000_supplier_reference_price_proposals`. Seule cette migration a été appliquée. RLS des deux nouvelles tables et droits d'exécution contrôlés ; aucune validation métier créée. Le panneau local « Examiner le prix » charge les deux offres de l'acétone et leurs motifs d'exclusion. La quantité et les conditions de transport restent à renseigner avant une moyenne comparable. Cette vérification ne constitue pas un déploiement du code applicatif.

1. Vérifier à nouveau l'historique et le schéma de la base cible. Le CLI local n'est pas lié ; l'historique a été consulté en lecture seule via le connecteur Supabase.
2. Obtenir l'autorisation explicite pour la migration `20260906145000_supplier_reference_price_proposals.sql`. Aucun `db push` global : les autres migrations locales appartiennent à des travaux concurrents.
3. Vérifier séparément l'activation de TI-535. TI-537 exclut déjà les offres de six mois ou plus, même avec une ancienne fin absente ; cela ne vaut pas application de la contrainte de TI-535.
4. Dans le catalogue, ouvrir « Examiner le prix », renseigner quantité et transport, préciser les conditions des offres, contrôler inclusions/exclusions et alerte, puis valider explicitement avec un responsable.
5. Vérifier la référence affichée, le journal de validation, un refus avec un lecteur, la conservation du prix après nouvelle offre/achat et les coûts des devis existants. Toute validation sur un article réel nécessite une décision métier explicite ; les tests automatisés n'en ont effectué aucune.

La politique définitive des offres fournisseur à zéro reste à trancher. Le comportement d'attente suspend la moyenne et expose l'anomalie. Aucun ticket Linear n'a été modifié et aucune publication n'a été réalisée par cette intervention.
