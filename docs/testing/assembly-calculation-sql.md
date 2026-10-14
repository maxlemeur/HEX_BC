# Finalisation financière d'une insertion de bibliothèque

Le POST de bibliothèque a un rouge navigateur réel : dans l'archive NI01 `2026-10-13T07-14-47-787Z`, la ligne vaut 1250/250/1500 centimes et le pied reste à zéro. L'oracle immédiat reste inchangé. La préparation TypeScript doit calculer toutes les lignes avec le moteur existant ; SQL valide son périmètre et appelle une seule fois le writer canonique `bulk_update_estimate_items`. Aucune formule financière supplémentaire n'est introduite.

## Défaillances définies avant la migration

1. Un succès ne persiste pas les lignes et le pied dans la même transaction financière.
2. Une projection ne couvre que les nouvelles lignes, duplique un ID ou touche une autre version.
3. La projection V2 écrase la sémantique brute V1, ou perd des champs métier et de provenance.
4. Un token ou une révision périmés autorisent un commit après modification de ligne/version.
5. Des changements de tarifs, de paliers ou de flag passent avec un contexte de snapshot nul ; les insertions dans des ensembles vides doivent aussi être détectées.
6. Une ancienne session, une expiration ou une reprise de bail permettent encore l'écriture.
7. Un viewer/director, un autre propriétaire, un tenant désactivé ou une membership révoquée contournent le contrôle au commit.
8. Des entrées nulles, mal formées, des montants hors borne ou des champs non financiers modifient les données.
9. Une faute tardive laisse une partie des écritures financières ; la matérialisation antérieure ne doit pas être supprimée.
10. Une réponse en ordre différent des IDs insérés casse l'identité du résultat, ou une finalisation invente un snapshot de publication.
11. Une perte de réponse est décrite comme rollback ou déclenche une réinsertion. Ce point exige une faute de transport réelle et une recette interface ; **la fixture SQL ne le prouve pas**.

## Exception d'isolation et frontières

Le fixture `src/test/fixtures/estimate-assembly-calculation-regression.sql` est écrit avant la migration. Il utilise les vrais writers et RLS, avec des identités synthétiques locales, puis force P9001. Il complète NI01/NI02/NI03 : un navigateur ne choisit pas déterministement le point entre projection et commit, ne peut pas appeler la RPC avec des shapes illégales sans changer le parcours et ne force pas une faute SQL après les updates mais avant le commit. Les cas de contexte, CAS, accès et bail sont séquentiels et ne qualifient pas une course réellement concurrente. Les cas financiers utilisent des projections de contrôle connues ; ils ne remplacent pas les oracles du moteur TypeScript, les exports ou l'interface.

Le runner ignoré réemploie `scripts/tester-army/local-native.py` et sa configuration dédiée. Chaque exécution crée un répertoire neuf, conserve le résultat rouge, exige la fin P9001 et compare indépendamment les données hachées, le catalogue, l'historique, les fonctions/OIDs/settings/ACL et les privilèges avant/après. Aucun seed ni DDL ne persiste. Le rôle SQL authenticated et ses claims synthétiques ne constituent pas une connexion navigateur ordinaire.

## Contrat

`finalize_estimate_assembly_calculation(version, expected_updated_at, expected_content_revision, session, inserted_ids, item_updates, version_patch, calculation_context)` fonctionne en invoker, avec un search_path vide. Les portes advisory acteur puis tenant reprennent l'ordre de `atomic_create_estimate_item`. Version, projet, bail et items sont verrouillés en ordre stable ; le statut draft, le tenant actif, le rôle admin/engineer, le propriétaire/admin et le bail exact non expiré sont revérifiés.

Les updates couvrent exactement toutes les lignes en V1 et V2 ; seuls `id`, `pu_ht_cents`, `line_total_ht_cents`, `line_tax_cents`, `line_total_ttc_cents` sont acceptés. Les montants sont des entiers positifs ou nuls dans la borne du type SQL integer. Le pied porte exactement HT/TVA/TTC. Les IDs insérés sont non vides, uniques et présents dans la version, sections comprises ; ils ne sont pas une autorisation de recalculer une autre version.

Les dépendances brutes sont comparées exactement à `EstimateCalculationDependencies` : rôles référencés par toutes les lignes, paliers triés si margin_mode=tiered et flag présent ou null. Les ensembles vides restent des données et sont protégés par les portes existantes. Le writer ne modifie ni rôle, provenance, position, métier, snapshot, ni définition ou ACL existante. Le retour est `{items, version:{id,updated_at}, totals}` relu dans la transaction et respecte l'ordre demandé des IDs insérés.

La matérialisation et la finalisation restent deux transactions : un échec financier peut laisser les items matérialisés. Aucun rollback intégral, idempotence ou retry d'insertion sûr n'est annoncé. Le serveur et l'interface doivent rendre cet échec partiel/indéterminé explicite.

## Périmètre d'application

Qualification transactionnelle seulement sur le runtime local autorisé API45585/DB33485 ; la migration nouvelle sera appliquée par le coordinateur après preuve et revue. Aucune base distante, publication Git ou modification de grants anciens n'est autorisée par ce travail.

Les fonctions invoker et leurs grants sont vérifiés conformément à la [documentation Supabase des fonctions](https://supabase.com/docs/guides/database/functions). Les migrations du repository et le runtime PostgreSQL17 vérifié font autorité pour les détails du schéma.
