# Base partagée · précontrôle des repères de comptage

La migration de la #474 est en attente. Les trois fichiers suivent l’ordre de leurs versions. Le correctif de la #481 prend effet à la troisième application. Les contrôles en lecture seule sont terminés et la séquence attend l’accord explicite du propriétaire pour l’intervalle entre la première application et la troisième. Aucune migration n’a été appliquée lors de ce contrôle. [PR #474](https://github.com/maxlemeur/HEX_BC/pull/474) · [Résultats détaillés](./shared-supabase-takeoff-count-marks-2026-11-22.json)

Le fichier de `main` au commit `441c7a14e845dd643c22b01adbbf5fe10c619f0d` compte 125 030 octets. Son SHA-256 est `dcae123aa4ff128a8a9f4f3c2a83d9004d3a555f5210b175861def99c0b01a14`. [Migration](../../supabase/migrations/20261122144104_takeoff_count_marks.sql)

Le précontrôle a trouvé zéro relation et zéro fonction portant les nouveaux noms. Les tables, les fonctions auxiliaires B1 et `extensions.unaccent` sont présentes. À 15:42:20 UTC, la base comptait 16 affaires, zéro réponse, zéro observation et 46 772 lignes d’audit. Aucun travail de métré n’était en traitement et aucun verrou concurrent n’était visible sur les tables visées. La production répondait HTTP 200 en v0.7.0.

L’historique correspond aux 428 lignes du reçu de la #470. Les quatre tables d’activation étaient vides. Aucun contrôle après application n’a été effectué. [Reçu de la #470](./shared-supabase-takeoff-item-answers-follow-up-2026-11-22.md)
