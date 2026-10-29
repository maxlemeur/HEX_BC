# Rattrapage Drive et métré sur le Supabase partagé — 29/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md#appliquer-sur-une-base-partagée).

**Cinq migrations de `main` appliquées dans l'ordre et vérifiées : leur SQL enregistré a le SHA-256 du fichier et du manifeste. Aucune connexion Google Drive n'existe, aucun document n'est lié depuis Drive, et ce reçu ne comporte aucun déploiement.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `d0e3476` (fusion de la [PR #126](https://github.com/maxlemeur/HEX_BC/pull/126)). Le porteur a donné son go explicite le 29/10/2026, à 08:00 UTC pour les quatre premières migrations et à 08:18 UTC pour la cinquième. Deux tentatives via l'outil MCP `apply_migration` depuis le fil Drive ont expiré sur la confirmation du connecteur, sans rien appliquer (historique relu à 08:04 et 08:21 UTC). Le porteur a ensuite appliqué lui-même les cinq fichiers, avec leur nom canonique.

| Ordre | Migration canonique | Origine | Octets | Lignes | SHA-256 (fichier = manifeste = instruction enregistrée) | Version distante |
|---|---|---|---|---|---|---|
| 1 | `20261028215442_reconcile_plan_intake_and_provenance.sql` | [PR #124](https://github.com/maxlemeur/HEX_BC/pull/124) | 25 585 | 415 | `292d40e872e589c2ee64b4438557a2dedd068c672f19f95096b966929f408977` | `20261029082230` |
| 2 | `20261028230728_preserve_confirmed_brief_after_plan_reconciliation.sql` | [PR #124](https://github.com/maxlemeur/HEX_BC/pull/124) | 8 387 | 143 | `69696dd50d879ad1cad13e2bd829db67108f616dc7e42fa66a73d022c57029ef` | `20261029082256` |
| 3 | `20261029002420_takeoff_preparations.sql` | commit `1234d5d` | 18 398 | 315 | `5cf7fcebaf5489496f6a802719d5539420e3964679e012d1d252cc17f19e95d8` | `20261029083959` |
| 4 | `20261029024800_google_drive_links.sql` | [PR #125](https://github.com/maxlemeur/HEX_BC/pull/125) | 14 061 | 241 | `20583afc33df0064c30cb33aa63b9d99c147f389a38f73ab4bd33dc9fb24cee0` | `20261029084057` |
| 5 | `20261029033000_google_drive_plan_working_copies.sql` | [PR #126](https://github.com/maxlemeur/HEX_BC/pull/126) | 14 532 | 221 | `7e4a20dedf0a43d483ee69513724282a91580bcba57404b447ca3fb683ac4c46` | `20261029084142` |

Le nom distant de chaque ligne est le nom canonique sans `.sql`. Pour la cinquième, l'instruction enregistrée compte 14 530 caractères pour 14 532 octets (deux caractères accentués dans les commentaires) ; son SHA-256 est celui du fichier.

## Avant

Contrôlé à 08:02:06 UTC. L'historique comptait 339 lignes, la dernière étant `20261025192608_intake_plan_generation_guard` (version `20261028103534`). Les cinq migrations manquaient et aucun de leurs objets n'existait :

- les colonnes `affaire_intake_documents.plan_copy_generation` et `drive_*`, et `takeoff_jobs.preparation_snapshot` ;
- les tables `private.affaire_plan_presence_state`, `public.takeoff_preparations`, `public.takeoff_preparation_profiles`, `public.google_drive_connections` et `public.affaire_google_drive_folders` ;
- la fonction `public.affaire_has_stored_plan(uuid)`.

## Vérifications après application

Contrôlé à 09:43:49 UTC.

- **Historique :** 344 lignes. Chaque nom apparaît une fois, dans l'ordre ci-dessus, avec une seule instruction enregistrée de SHA-256 égal au fichier.
- **Colonnes :** `affaire_intake_documents` porte `plan_copy_generation`, `drive_connection_id`, `drive_file_id`, `drive_folder_id`, `drive_folder_name`, `drive_modified_time`, `drive_revision` et `drive_shared_drive_id`. `takeoff_jobs` porte `preparation_snapshot`.
- **Bucket :** `dpgf-imports` accepte désormais `application/pdf`.
- **Tables :**
  - `public.google_drive_connections` : RLS active, 2 politiques (lecture et suppression de ses propres connexions, rôle `authenticated`).
  - `public.affaire_google_drive_folders` : RLS active, 4 politiques pour `authenticated`.
  - `private.google_drive_connection_secrets` : RLS active, aucune politique, aucun droit pour `anon`, `authenticated` ni `service_role`.
  - `private.affaire_plan_presence_state` : RLS active, aucune politique, aucun droit pour les rôles de l'API.
  - `public.takeoff_preparations` et `public.takeoff_preparation_profiles` : RLS active, une politique chacune, lecture seule pour `authenticated`, écriture par `service_role`.
- **Fonctions réservées au serveur** (SECURITY DEFINER, propriétaire `postgres`, ACL `{postgres=X/postgres,service_role=X/postgres}`, ni `anon` ni `authenticated` n'ont EXECUTE) : `affaire_has_stored_plan(uuid)`, `reconcile_affaire_plan_gap(uuid, uuid)`, `resolve_affaire_brief_plan_gap(uuid, integer, timestamptz, uuid)`, `google_drive_connection_secret(uuid)` et `save_google_drive_connection(uuid, uuid, text, text, text, text)`.
- **Copie de travail métré :** les cinq fonctions redéfinies par la cinquième migration (`affaire_has_stored_plan`, `guard_intake_plan_copy_lifecycle`, `delete_stale_intake_plan_file`, `private.guard_plan_storage_write`, `private.guard_intake_plan_metadata`) portent bien la règle Drive (`intake_drive_file_id`). Leur version active est donc celle de la cinquième migration.
- **Déclencheurs :** `rotate_intake_plan_copy_generation`, `guard_intake_plan_metadata`, `guard_plan_storage_write`, `guard_intake_plan_storage_delete`, `guard_import_plan_set_delete`, `zzz_guard_google_drive_connection_reference` (sur deux tables), `remove_google_drive_connections_of_former_member`, `aad_enforce_takeoff_job_preparation`, `enforce_takeoff_preparation_write` et `enforce_takeoff_preparation_profile_write`.
- **Données :** aucune connexion Google Drive, aucun document lié depuis Drive (`storage_path` nul).
- **Comptes relus dans le catalogue :** aucune fonction de `public` n'est exécutable par `anon`. 70 fonctions SECURITY DEFINER de `public` sont exécutables par `authenticated`, comme avant.
- **Advisors de sécurité (09:44 UTC) :** aucun nouvel avertissement. Les deux tables privées rejoignent la liste INFO « RLS sans politique » (23 entrées au lieu de 21), ce qui est voulu pour des tables réservées au serveur. Les avertissements existants sont inchangés : 70 fonctions SECURITY DEFINER exécutables par `authenticated`, et la protection contre les mots de passe divulgués reste désactivée.

## Limites

- Aucun déploiement. Côté base, `main` à `d0e3476` est maintenant déployable ; la publication reste un go séparé du porteur.
- L'accès réel à Google Drive (OAuth) n'est pas activé et demande son propre go.
- Aucun parcours fonctionnel n'a été exécuté sur le partagé. Les corps de fonction n'ont pas été comparés un à un à la source : la preuve d'identité est le SHA-256 de l'instruction enregistrée.

[Rapport JSON](./shared-supabase-drive-links-2026-10-29.json).
