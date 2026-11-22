# Base partagée · précontrôle des décisions de revue de métré

**La migration de la #471 n’a pas été appliquée.** Le contrôle des droits de la nouvelle commande de revue a soulevé un point qui demande une décision du propriétaire. L’arrêt a précédé tout appel à `apply_migration`. Les constats techniques ont été transmis en privé. [Migration](../../supabase/migrations/20261122125722_takeoff_item_review_decisions.sql) · [Précontrôle détaillé](./shared-supabase-takeoff-item-review-2026-11-22.json)

L’historique partagé compte **428 lignes**, identiques au reçu de la #470. Sa dernière version est `20261122135550`. Le fichier de la #471, au commit `28e114e9d35d196918626d9147195d997245cae9`, compte **73 749 octets** et son SHA-256 est `5a07546488d92fc9288ff526f570f2658cfb674b83921d365763b054e5e3b299`. [Reçu de la #470](./shared-supabase-takeoff-item-answers-follow-up-2026-11-22.md)

Les trois compteurs du précontrôle de la PR étaient à zéro. À 14:42:53 UTC, la base comptait zéro tâche en traitement, zéro réponse, zéro élément et 46 772 lignes d’audit. Aucun verrou détenu par une autre session n’était visible sur les trois tables ciblées. Le MD5 du corps de `private.takeoff_item_reading_states` correspondait à la migration B1 (`5d0825ac5c143ce338a993927d37247a`). Le point de santé de production répondait HTTP 200 en v0.7.0. [PR #471](https://github.com/maxlemeur/HEX_BC/pull/471)

Les quatre tables d’activation étaient vides. Aucune version distante n’a été créée pour la #471. Les vérifications du catalogue après application et la comparaison des nouveaux constats de l’advisor sont donc sans objet.
