# Base partagée · lecture du radar de risque et demandes de lancement du 21 novembre 2026

Les migrations des PR #441 et #436 ont été appliquées et vérifiées, dans cet ordre. L’historique est passé de **418 à 419, puis à 420 lignes**. Les avis et le lancement automatique restent inactifs. [Résultats détaillés](./shared-supabase-risk-radar-and-launch-requests-2026-11-21.json)

| Migration | Application UTC | Version distante | Octets | SHA-256 |
| --- | --- | --- | ---: | --- |
| [Lecture du radar](../../supabase/migrations/20261121160259_read_takeoff_risk_alerts.sql) | 17:57:51 | `20261121175751` | 5 966 | `a42ad6c51b8660c591d710ddbd3b39e860ad6890c860917ab2d067d4b58b7167` |
| [M4 · demandes de lancement](../../supabase/migrations/20261121170448_takeoff_launch_requests.sql) | 17:59:31 | `20261121175931` | 103 804 | `6b349bdb73d635acef5044efc7dd1897f8db8672fa07cc1ee5e52bbf2c7fd8f2` |

Chaque application a réussi au premier appel. Dans les deux cas, le SQL enregistré est identique au fichier de `origin/main` au commit `8626301bf3b50e5221f0cebde272d17229eb16c2`, dernier saut de ligne compris. Les empreintes de référence et les 418 couples version/nom du reçu précédent ont été vérifiés. Les deux lignes ci-dessus sont les seuls ajouts. [Reçu précédent](./shared-supabase-takeoff-send-followup-2026-11-21.md)

## Lecture du radar de risque · #441

La fonction était absente. Ses cinq tables et ses fonctions auxiliaires existaient. Après l’application, `public.read_takeoff_risk_alerts(uuid,uuid,uuid)` appartient à `postgres` et renvoie un ensemble de lignes de `estimate_risk_alerts`. Elle est `STABLE SECURITY DEFINER`, avec un `search_path` vide. Son corps a pour MD5 `29b8ed676d7d18ac779643c991a8ce70`, identique au fichier. Les rôles `authenticated` et `service_role` peuvent l’exécuter. Les droits de `PUBLIC` et `anon` sont révoqués. [PR #441](https://github.com/maxlemeur/HEX_BC/pull/441)

L’advisor de sécurité a signalé un nouveau WARN pour cette fonction, exécutable par `authenticated` avec les droits de son propriétaire. La table d’activation des avis était vide. [Fiche de l’advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

## Demandes de lancement · M4

**Avant l’application.** La requête de la PR a trouvé les cinq prérequis, aucune table de demandes préexistante et aucun avis associé à une demande. Les noms des nouveaux objets étaient libres. Le corps de `public.duplicate_estimate_version_without_product_id(uuid,boolean)` avait le MD5 attendu, `11f873c06ace9acfdcc4d233bf9e1e4f`. À 17:59:22 UTC, la base comptait **0 tâche de métré**, dont 0 en traitement, et **46 772 lignes d’audit**. Aucune autre session ne détenait ni n’attendait de verrou sur les sept tables contrôlées. Le point de santé de production a répondu HTTP 200, version **0.7.0**, base disponible. [PR #436](https://github.com/maxlemeur/HEX_BC/pull/436) · [Point de santé](https://hex-bc.vercel.app/api/health)

**Catalogue après l’application.** Les colonnes, contraintes, index, politiques et droits des six nouvelles tables ont été contrôlés. Les cinq tables privées ne donnent aucun droit de table aux rôles API. La table publique des demandes a la RLS activée. Le rôle `authenticated` peut lire 25 de ses 41 colonnes, sous la politique de lecture de l’affaire. Le rôle `service_role` dispose des droits SELECT, INSERT, UPDATE et DELETE.

- Les colonnes `takeoff_jobs.launch_request_id` et `launch_unit_key` sont présentes et acceptent NULL. L’index unique reconstruit `takeoff_jobs_prepared_plan_receipt_uidx` couvre les préparations avec un jeu de plans et sans demande. Un index unique distinct couvre la paire demande/unité.
- La contrainte `audit_logs_action_check` contient les 23 actions du fichier, dont `takeoff.request.mandated` et `takeoff.request.admitted`. Elle est enregistrée `NOT VALID`, comme prévu pour les lignes historiques.
- Les 16 déclencheurs prévus sont actifs, dont les dix sur le brief, les pièces du dossier, les fichiers de plan et les préparations. Les 49 fonctions déclarées ont la signature et le MD5 du fichier. La fonction de copie modifiée séparément a le nouveau MD5 attendu, `f8fdd1470e774fe76e6d020fa989bac8`.

**État final.** Les demandes de lancement et les deux tables d’activation, `private.takeoff_launch_activation` et `private.takeoff_completion_activation`, comptaient chacune **0 ligne**. L’advisor de sécurité n’a relevé aucun nouveau constat après M4. Aucun déploiement ni changement de flag n’a eu lieu. Les vérifications sur la base partagée ont porté sur l’historique, le catalogue et les comptages. Aucun parcours utilisateur ni test de performance du radar n’a été exécuté en production.
