# Reçu partagé — pièces facultatives — 11 novembre 2026

La seule migration `20261111130710_optional_dossier_documents.sql` a été appliquée au projet Supabase partagé MergeOne (`ijropnynpwjbllievrip`) le 11 novembre 2026, après l’autorisation explicite du propriétaire d’appliquer le SQL immédiatement, sans attendre la CI ni déployer l’application.

## Identité

- Source immuable : `supabase/migrations/20261111130710_optional_dossier_documents.sql`, commit `cb506c4794dfe41a4477a9f88041383556bf3905` de la [PR #210](https://github.com/maxlemeur/HEX_BC/pull/210).
- SHA-256 du SQL envoyé : `7e22ac6904f34cf79b4c9ace9a72edf77d4b22060199f442d404b4c16f9faa54`.
- Outil : Supabase MCP `apply_migration`, nom `20261111130710_optional_dossier_documents`.
- Historique distant contrôlé après application : version `20261111190106`, nom `20261111130710_optional_dossier_documents`.
- Une seule application, sans `db push`, sans rattrapage d’autres migrations. Le nom et le contenu du fichier appliqué doivent être conservés.

## Résultat observé sur le partagé

Les 16 entrées système ciblées sont désormais de sévérité `warning`. Avant application, huit étaient critiques, dont quatre actives et ouvertes ou à clarifier. Les identités, statuts et indicateurs `is_active` des 16 entrées sont conservés ; 16 événements portent la raison `intake.optional_documents`.

Aucune dérogation de sévérité manuelle n’était présente dans ce lot. La règle de conservation des exigences manuelles reste dans le SQL et a été couverte par le test local de reprise sur données préexistantes. La vérification du dossier signalé ne trouve plus de pièce manquante automatique critique active.

Le corps installé de `reconcile_affaire_plan_gap(uuid, uuid)` correspond exactement au corps relu. Son exécution reste refusée à `anon` et `authenticated`, et permise à `service_role`. Les types, niveaux et nombres des avis de sécurité sont identiques avant et après ; aucun avis préexistant n’a été corrigé par cette opération.

## Portée et récupération

Cette preuve porte sur la migration partagée et les entrées existantes. Elle ne prouve ni fusion de la PR applicative, ni déploiement applicatif. L’ancien code d’intake peut encore recréer un manque DPGF critique lors d’un nouvel import jusqu’à l’activation du code compatible de la PR #210.

Un checkpoint privé des seules valeurs modifiées et les vérifications avant/après sont conservés dans `outputs/optional-documents-shared-apply-20261111/`, hors Git. Il ne faut pas rétablir des valeurs sur des entrées modifiées ensuite par un utilisateur. Les événements d’audit conservent aussi les sévérités précédentes. Aucun document, montant, ligne de devis ou compte n’a été supprimé par la migration.
