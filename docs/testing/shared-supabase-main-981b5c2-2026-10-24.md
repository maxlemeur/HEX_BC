# Rattrapage de `main` sur le Supabase partagé — 24/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Deux migrations appliquées et vérifiées ; quatre autres, déjà présentes sans reçu, rapprochées à l'octet près. Seuls `public.commit_estimate_batch` et une policy de lecture Storage changent. Aucune donnée modifiée et aucun déploiement.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `981b5c2` (fusion de la [PR #94](https://github.com/maxlemeur/HEX_BC/pull/94)). Autorisation permanente du porteur du 24/10 pour appliquer les migrations du dépôt au partagé quand c'est nécessaire, confirmée pour cette application.

## Migrations appliquées

| Migration | Octets | SHA-256 (fichier = instruction enregistrée) | Version distante | Application (UTC) |
|---|---|---|---|---|
| `20261019123000_estimate_batch_set_based_creates.sql` | 45 423 | `6d124d2201402dd34e9e1d26256492eaf9d36099d5fac101215d64eb193132e1` | `20261024112732` | 24/10/2026 11:27:32 |
| `20261024000936_google_drive_pending_copy_recovery.sql` | 1 637 | `6227ca74a8ff01d798da88053b064b945960c3a3b6a13bdc62485390bb05609e` | `20261024112810` | 24/10/2026 11:28:10 |

Contenu extrait par `git show 981b5c2:<fichier>`, SHA-256 identiques au [manifeste](../../supabase/migrations.manifest.json), puis transmis complet (BEGIN/COMMIT compris) à `apply_migration` du MCP Supabase, dans l'ordre, une tentative chacune. Pas de `supabase db push`.

Les essais depuis une session cloud ont expiré sur la question de confirmation du connecteur, sans exécution (historique relu ensuite, inchangé). L'application a été faite depuis le Mac du porteur, en mode « Demander les permissions » : en mode auto, le classifieur de Claude Code refuse `apply_migration` avant envoi.

## Préflight en lecture seule

- Historique : **317 lignes / 313 noms**, dernière version `20261023230907`. Les deux noms ci-dessus sont absents, revérifiés juste avant l'application.
- `commit_estimate_batch` partagé : MD5 `prosrc` LF `7bc2f6c5702364b39fa6582cb363591c`, identique à sa dernière source canonique `20261018180306_estimate_v3_batch_copy_effects.sql` (aucune dérive écrasée) ; SECURITY DEFINER, `search_path=""`, propriétaire `postgres`, ACL `{postgres=X/postgres,authenticated=X/postgres}`, une seule surcharge. Prérequis du préflight de la migration présents.
- Drive : policy absente ; tables `affaire_intake_documents`/`_uploads`/`_events`, colonnes utilisées, `current_tenant_id()`, `can_access_affaire_intake_project(uuid,uuid)` et bucket privé `affaire-intake` présents.

## Après application

- Historique **317 → 319 lignes**, une ligne par nom ; empreinte des 317 lignes antérieures identique avant/après (`5fd9e151a86ee6915d3de1f2ca9049a4`).
- `commit_estimate_batch` : MD5 `prosrc` LF `be31a92e1680b0af83c33c3abc9ae896` = corps de la migration ; SECURITY DEFINER, `search_path=""`, propriétaire et ACL conservés.
- `storage.objects` : policy « Project writers can verify pending Drive copies », PERMISSIVE, SELECT, `authenticated`.
- Catalogue `public`/`private`/`storage` empreinté avant/après (corps, configuration, mode, retour, arguments, ACL, propriétaire des **446 fonctions** ; **377 → 378 policies** ; colonnes, défauts, contraintes, index, déclencheurs, RLS et ACL des **132 relations**) : seules les deux cibles changent.
- Données `public`/`private` : **124 tables / 56 374 lignes**, empreinte `ce6eedb4bc552befc6a69c89a662918b` identique avant/après (MD5 par ligne `to_jsonb`, trié, puis par table).
- Conseillers de sécurité identiques constat par constat : 18 SECURITY DEFINER accessibles à anon, 66 à authenticated, 19 RLS sans policy, 1 protection des mots de passe divulgués.

## Migrations de `main` déjà présentes sans reçu

Appliquées au partagé avant ce rattrapage, sous leur nom canonique ; l'instruction enregistrée a le SHA-256 exact du fichier.

| Migration | Version distante | SHA-256 |
|---|---|---|
| `20261020004336_restrict_membership_directory_lookup.sql` | `20261020010631` | `94c051cd194651417287bc3053bede2fde4753a5ba758437bcc731aa02c3cc4a` |
| `20261022074859_close_takeoff_audit_forgery.sql` | `20261022085931` | `27920655c1f764564d910103d5bb8eef6ab6747491391e01f9e7c4636d3cf24f` |
| `20261022075204_bound_takeoff_job_admission.sql` | `20261022085945` | `272502cd0fd58c7aae7cf97aa449b181db251ab17f023203166369f385c99774` |
| `20261023132913_select_authorized_email_recovery.sql` | `20261023161922` | `06acc76e161ab2cddf34078e0d540adc49f84e44321220eaee310620d14148b2` |

Leurs objets correspondent à la source : corps de `find_membership_candidate_by_email`, `enforce_takeoff_job_admission`, `enforce_takeoff_job_reactivation`, `enforce_takeoff_processing_admission` et `list_due_estimate_email_dispatches` égaux (MD5 LF), EXECUTE réservé à `service_role` ; tables d'admission sous RLS forcée, sans droit pour les rôles API, avec leurs index ; trois déclencheurs sur `takeoff_jobs` actifs ; la policy d'insertion d'audit élargie est remplacée par « Authenticated can insert invariant violation audit logs ». `20261023222150` et `20261023230340` ont leurs propres reçus du 24/10.

Ligne distante hors dépôt : `provision_mergeone_backup_reader` (version `20261022112603`, 389 octets).

## Écarts connus, non traités ici

- Trois anciennes migrations du dépôt restent absentes par nom (`20260714120000`, `20260714134334`, `20260718014058` vide) ; les définitions suivantes de leurs fonctions sont appliquées. Écart préexistant.
- Le déclencheur canonique `guard_estimate_approvals_insert_trigger` et sa fonction manquent sur `estimate_approvals` (0 ligne), comme `assign_estimate_explanations_scope()`.
- Fonctions présentes seulement sur le partagé : `get_takeoff_secret(text)` (SECURITY DEFINER, EXECUTE `service_role`) ; `set_estimate_explanation_scope_defaults()` et `set_estimate_explanation_source_scope_defaults()` (SECURITY DEFINER, EXECUTE PUBLIC/anon/authenticated, utilisées par des déclencheurs : ce sont les deux constats anon de plus que `main`) ; `sync_estimate_explanation_source_contract()` (déclencheur) ; `assign_estimate_template_item_tenant_id()` (sans déclencheur).

## Limites

Aucun appel métier de `commit_estimate_batch`, aucun import Drive (fonction désactivée) et aucun déploiement. Les preuves fonctionnelles restent celles des PR d'origine. [Rapport JSON](./shared-supabase-main-981b5c2-2026-10-24.json).
