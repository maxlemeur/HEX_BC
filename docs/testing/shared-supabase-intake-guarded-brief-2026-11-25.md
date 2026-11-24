# Publication du brief et reprise des analyses · 25 novembre 2026

La [migration de la PR #553](../../supabase/migrations/20261124210748_intake_guarded_brief_and_recovery.sql) a été appliquée à la base partagée le **25 novembre à 00:16:24, heure de Paris** (24 novembre à 23:16:24 UTC). Un seul appel à `apply_migration` a enregistré le fichier entier, saut de ligne final compris. [PR #553](https://github.com/maxlemeur/HEX_BC/pull/553)

| Identité | Valeur |
| --- | --- |
| Version distante | `20261124231624` |
| Nom enregistré | `20261124210748_intake_guarded_brief_and_recovery` |
| Commit source sur `main` | `0c28983f54083bc33e1240bb009236bd5ca005dc` |
| SQL enregistré | 1 entrée de 22 668 octets |
| SHA-256 du fichier et du SQL enregistré | `2d560880fdf310add6ca38484f6c6196a0fdca204b791a9cda2be9b138c8dc63` |

L’historique est passé de 447 à 448 entrées. L’empreinte des 447 entrées jusqu’à la version `20261124211715` est identique avant et après. Au contrôle, la migration de la [PR #535](https://github.com/maxlemeur/HEX_BC/pull/535) figurait sur `main` et était absente de l’historique partagé. La [PR #547](https://github.com/maxlemeur/HEX_BC/pull/547) était ouverte et sa migration était également absente.

## Données et compatibilité avec la production

| Mesure en lecture seule | Avant | Après |
| --- | ---: | ---: |
| Dépôts et lots | 19 | 19 |
| Documents | 51 | 51 |
| Briefs | 9 | 9 |
| Dépôts en statut `launch_*` / avec `launch_read_scans` renseigné | 0 / 0 | 0 / 0 |
| Documents en attente de lancement / affectés à un lancement | 0 / 0 | 0 / 0 |

Les deux colonnes ajoutées acceptent NULL sans valeur par défaut. L’index partiel est non unique et aucun lot existant ne relevait de son prédicat. Le fichier ne crée aucune contrainte à valider sur les lignes en place. L’installation des déclencheurs ne les rejoue pas. Après application, les 51 dates `analysis_completed_at` et les 19 révisions `brief_published_revision` sont toutes NULL. La migration n’a déclenché aucune analyse. Le point de santé a répondu HTTP 200, version 0.9.0, base disponible avant et après. Le parcours d’analyse au dépôt n’a pas été rejoué en production. [Santé de production](https://hex-bc.vercel.app/api/health)

## Catalogue vérifié

L’index `affaire_intake_unpublished_launches` est valide et prêt. Il porte sur `project_id` pour les lots en échec avec un choix de lecture et sans révision publiée. Les cinq déclencheurs visés sont activés sur les tables prévues. Deux portent sur les documents, deux sur la confirmation d’un brief et un sur la clôture d’un lancement explicite.

Le déclencheur `release_reserved_intake_piece` tient désormais compte d’une lecture inachevée lors d’une réservation de suppression. Le SHA-256 de sa définition PostgreSQL est passé de `77997f21c8e10d8758a4b79f8009e823d7ff7686ae1fd3428808a82352e861e3` à `a26aa56aefe4ed79fbaa2c9c33617b887ff43f9a819f4b787344e8ef1a5e4ccd`. Sa fonction conserve la définition de la [migration précédente](../../supabase/migrations/20261124182705_affaire_intake_analysis_launch.sql), avec le même MD5 du corps avant et après (`b406c99a638d5fee6c8bfe1e8c396136`).

Les neuf nouveaux corps de fonction correspondent au fichier. Les droits d’exécution observés sont les suivants.

| Fonctions | Rôle API autorisé |
| --- | --- |
| `start_affaire_intake_analysis` | `authenticated` |
| `intake_payer_can_write`, `stop_affaire_intake_analysis`, `publish_affaire_intake_brief`, `read_affaire_intake_brief_inputs` | `service_role` |
| Les quatre nouvelles fonctions privées | Aucun |

Les deux fonctions `SECURITY DEFINER`, `public.start_affaire_intake_analysis` et `private.require_intake_brief_publication`, fixent un `search_path` vide.

## Nouveaux avis Supabase

- **Sécurité · 1 avertissement.** Le rôle `authenticated` peut exécuter `start_affaire_intake_analysis` en mode `SECURITY DEFINER`. Ce droit est prévu par la migration. La commande réutilise la réservation autorisée et vérifie le droit d’écriture pour le cas d’un brief seul. [Règle Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- **Performance · 1 information.** L’index `affaire_intake_unpublished_launches` n’avait enregistré aucune utilisation lors du contrôle. [Règle Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
