# TI-686 — fin du lot 2 sur le Supabase partagé, 10/11/2026

> Procédure : [application sur une base partagée](../../supabase/README.md#appliquer-sur-une-base-partagée). Reçu précédent : [rattrapage partiel](./shared-supabase-main-catchup-2026-11-10.md), commit `46089078600e0b6d679f0726453c8ad9a9baeadd`. Détails, empreintes, précontrôles et requêtes de relecture : [JSON](./shared-supabase-ti686-completion-2026-11-10.json).

**Les cinq migrations restantes autorisées sont appliquées et vérifiées sur `ijropnynpwjbllievrip` (`bon_de_commande`), base partagée servant aussi la production. Les six migrations du lot 2 TI-686 sont donc présentes, avec la première attestée par le reçu précédent. Aucun déploiement ni activation de `MERGEONE_TAKEOFF_RULES`.**

Le propriétaire a explicitement autorisé ces cinq applications, dans cet ordre, et leur reçu poussé sur main. Chaque appel utilise `apply_migration` et la confirmation du connecteur. SQL extrait directement des blobs de `origin/main`, figé à `46089078600e0b6d679f0726453c8ad9a9baeadd` après fetch : aucun fichier SQL réécrit. Travail effectué dans la worktree ; aucun changement au répertoire de travail du clone canonique.

## Applications et identité

| Migration canonique | Version distante | Octets fichier / enregistrés | SHA-256 |
|---|---|---:|---|
| [20261110094501_takeoff_quantity_entry_category](../../supabase/migrations/20261110094501_takeoff_quantity_entry_category.sql) | `20261110115619` | 16330 / 16330 | Identique |
| [20261110094502_takeoff_acceptance_outline_reason](../../supabase/migrations/20261110094502_takeoff_acceptance_outline_reason.sql) | `20261110115728` | 7792 / 7792 | Identique |
| [20261110094503_takeoff_apply_provisions](../../supabase/migrations/20261110094503_takeoff_apply_provisions.sql) | `20261110115759` | 24827 / 24827 | Identique |
| [20261110094504_takeoff_apply_force_reasons](../../supabase/migrations/20261110094504_takeoff_apply_force_reasons.sql) | `20261110115826` | 21010 / 21010 | Identique |
| [20261110094505_takeoff_override_consumptions_admin_read](../../supabase/migrations/20261110094505_takeoff_override_consumptions_admin_read.sql) | `20261110115859` | 1306 / 1306 | Identique |

Une entrée et une instruction enregistrée par nom. La taille et le SHA-256 de chaque texte enregistré correspondent au fichier complet, saut final inclus. Les empreintes exactes figurent dans le JSON.

## Contrôles

- Historique initial conforme : 367 entrées, dernière `20261110114023` pour `20261110094500_takeoff_acceptance_reasons`, les cinq noms autorisés absents. Historique final : 372 entrées ; les 367 précédentes sont inchangées et seuls les cinq noms autorisés ont été ajoutés.
- Avant chaque application : absence de son entrée d’historique, absence des nouveaux objets concernés ou identité du corps remplacé contrôlée, prérequis présents, neuf tables de métré comptées exactement. Tous leurs comptages restent à zéro avant chaque application et à la fin. Aucun contrôle n’écrit de donnée métier.
- **155 contrôles du catalogue, des droits et des corps : OK.** Les 21 définitions de fonctions observées correspondent aux fichiers attendus ou, pour les définitions inchangées, au reçu précédent. Cela inclut la surcharge de revue à six arguments, conservée et comparée à sa migration source.
- Les neuf définitions finales créées ou remplacées par ce lot sont identiques par SHA-256 de `pg_proc.prosrc`. Propriétaires, signatures, configuration, SECURITY DEFINER et ACL sont consignés. Les droits des 15 définitions contrôlées dans le reçu précédent sont conservés ; aucun EXECUTE à PUBLIC ou anon sur les 21 définitions observées. Les helpers privés et les fonctions de trigger sensibles restent sans EXECUTE pour authenticated/service_role, conformément au SQL.
- Deux colonnes de saisie nullable de type text, sans valeur par défaut ; quatre contraintes de saisie présentes et validées, catégories et bornes de notes conformes au SQL. Cinq triggers actifs ; le trigger d’audit observe aussi les deux nouveaux champs.
- RLS active sur les neuf tables comptées. Elle reste forcée sur les quatre tables attestées par le reçu précédent, notamment les consommations d’override. La politique « Admins can view override consumptions » est SELECT pour authenticated, filtrée par le rôle admin du tenant. authenticated obtient SELECT seul, aucun droit anon, droits service_role conservés. Aucun droit d’écriture supplémentaire.
- Les objets du rattrapage précédent restent conformes : colonne et contrainte de provenance des prix, index valide, bucket intake privé autorisant le type binaire. Les triggers non modifiés du reçu précédent restent présents.

## Avis de sécurité

Les identités et détails de tous les avis avant application correspondent au reçu `46089078`, en excluant seulement leurs horodatages d’observation. Après application, un seul constat disparaît : RLS sans politique sur `public.takeoff_apply_override_consumptions`, conséquence attendue de la cinquième migration. Aucun constat ajouté ; tous les autres détails restent identiques.

| Avis | Reçu précédent / avant | Après |
|---|---:|---:|
| [INFO RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 25 | 24 |
| [WARN fonctions SECURITY DEFINER exécutables par authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 70 | 70 |
| [WARN mots de passe divulgués](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 | 1 |

Les avertissements préexistants restent ouverts.

## Portée de la preuve

Cette preuve établit les applications, l’identité du SQL enregistré, le catalogue, les droits, les comptages et les avis. Aucun parcours authentifié d’écriture ni qualification de release exécuté sur la base partagée. Aucune suite applicative locale relancée : le diff dépôt ne contient que ce reçu documentaire, les migrations et le code applicatif sont inchangés. L’état effectif du flag dans les environnements déployés n’a pas été relu ; cette opération n’active aucun flag.
