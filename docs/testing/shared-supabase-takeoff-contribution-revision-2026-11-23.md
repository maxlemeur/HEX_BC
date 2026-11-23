# Révision d’une contribution de métré · 23 novembre 2026

La migration de [#522](https://github.com/maxlemeur/HEX_BC/pull/522) a été appliquée à **18:10:38 UTC** en une transaction. L’historique passe de **443 à 444** migrations. Les 443 entrées antérieures conservent leur empreinte.

| Version distante | Octets | SHA-256 du fichier et du SQL enregistré |
| --- | ---: | --- |
| `20261123181038` | 282 294 | `2f7d23647ae669b0d2d3a46f80abe145c7c6a79b39f5bb3f0b95f91fcd542e56` |

Le texte SQL enregistré comprend le saut de ligne final. Il correspond au [fichier sur main](../../supabase/migrations/20261123062008_takeoff_contribution_revision.sql) au commit `227f22ee8d0c8a0ed02878abb1bfc6676953c9b1`.

## Précontrôles

Les deux requêtes de #522 ont renvoyé zéro ligne. À 18:10:25 UTC, le dernier contrôle trouvait zéro analyse en attente ou en traitement, demande de lancement ouverte, réservation non réglée ou verrou détenu par une autre session sur les dix tables d’envoi. Aucun reçu ne contrevenait aux nouvelles contraintes. La nouvelle colonne de prédécesseur est nullable et sans défaut.

## Vérification du catalogue et des données

| Fonction remplacée | MD5 du corps avant | MD5 du corps après |
| --- | --- | --- |
| `private.guard_takeoff_item_send_write` | `4d6b75528cac81f8f229cb30cb645d72` | `21fc082fbee7950e1edb33542677f969` |
| `private.takeoff_item_send_carry_copy` | `62a8c5848b805565b0543001aca85f06` | `215d84a37f42c86a206099e1427d9981` |
| `private.takeoff_item_send_plan_valid` | `931d38ebf441d801164bbf098a978df6` | `1f162c93a81f00b7767ccccdff199d3a` |
| `public.edit_takeoff_count_marks` | `c94bfdb0542d65e74f0f363e0490e792` | `5841f73b5777ceb62f8b170e9dcf9dab` |
| `public.review_takeoff_items` | `0a3f01eaaa693c6fa8dc86fed44dc0af` | `dd96c8a7ca2ca6193e4eab737a6d4cff` |
| `public.send_takeoff_item_plan` | `4d8dd1da022b84d6aa7282d895cfbffc` | `78d37c25a584d3e21d9f387ad782ba02` |

Les six corps antérieurs correspondaient à leurs dernières définitions sur main. Après application, les 23 corps correspondent à #522. Les six fonctions remplacées conservent leur signature, leur propriétaire, leur mode de sécurité et leurs droits. Aucun rôle API ne peut exécuter les onze nouvelles fonctions privées. Aucun nouveau droit d’exécution pour `anon`. Les quatre nouvelles fonctions destinées aux membres sont exécutables par `authenticated`. La prévisualisation et la confirmation sont réservées à `service_role` parmi les rôles API.

Les contraintes sont validées et l’index unique partiel sur le prédécesseur est valide. La nouvelle table privée `takeoff_revision_choices` est vide, avec RLS active et les seuls droits de son propriétaire. Les effectifs des dix tables d’envoi, de `takeoff_jobs` et de `estimate_items` sont identiques avant et après. Les quatre [lignes d’activation](shared-supabase-takeoff-activation-2026-11-23.md) conservent leurs dates et leurs paramètres. Le point de santé de production a répondu HTTP 200 en version 0.9.0, base disponible, avant et après la migration.

## Nouveaux constats de l’advisor

- **4 WARN** pour les fonctions `SECURITY DEFINER` que `authenticated` peut exécuter, `edit_takeoff_revision_entry`, `edit_takeoff_revision_marks`, `read_takeoff_contribution_revision` et `review_takeoff_revision_item`. [Avis Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- **1 INFO** pour la RLS sans politique de `private.takeoff_revision_choices`. [Avis Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- **2 INFO** pour les clés étrangères sans index couvrant, de la table des choix vers le reçu et du reçu vers son prédécesseur. [Avis Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)

[Résultats détaillés](shared-supabase-takeoff-contribution-revision-2026-11-23.json)
