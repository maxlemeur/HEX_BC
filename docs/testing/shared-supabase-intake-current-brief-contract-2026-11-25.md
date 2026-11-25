# Confirmation du brief sur les entrées actuelles du dossier · 25 novembre 2026

**La règle est installée et reste désactivée.** Le 25 novembre à 03:06:36 UTC (04:06:36 à Paris), la base partagée a enregistré la migration de la [PR #559](https://github.com/thannous/HEX_BC/pull/559). Après application, `private.intake_current_brief_activation` contenait zéro ligne et `public.intake_current_brief_active()` renvoyait `false`.

| Identité | Valeur vérifiée |
| --- | --- |
| Commit sur `main` | `c033735053d76eb741371e81fc870358a98ce488` |
| [Migration](../../supabase/migrations/20261125004459_intake_current_brief_contract.sql) | `20261125004459_intake_current_brief_contract` |
| Version distante | `20261125030636` |
| SQL enregistré | Un appel à `apply_migration`, un élément dans `statements`, 32 434 octets, saut de ligne final compris |
| SHA-256 du fichier et du SQL enregistré | `9e79bbe4e7867a87a3ebbcb67479850e0a8689166c9a8e4f51ea03e1740dd476` |

L’historique est passé de 449 à 450 entrées. Les 449 entrées antérieures ont conservé leur empreinte. La migration de la [PR #535](https://github.com/thannous/HEX_BC/pull/535) figurait sur `main` et était absente de l’historique partagé.

## Données avant et après l’application

Pour chaque table du dossier, le calcul utilise toutes les colonnes présentes avant l’application, dans le même ordre lors des deux lectures. Chaque ligne est représentée par un tableau JSONB de ses colonnes converties en texte, avec conservation des NULL. Les lignes sont agrégées par identifiant croissant avant le calcul du SHA-256 sur le texte UTF-8.

| Données | Avant | Après | SHA-256 identique aux deux lectures |
| --- | ---: | ---: | --- |
| Documents du dossier | 51 | 51 | `63dcddca30895f36f57aeb07ad91d9bd2509d3bdcc359275726ff6dec79b22d4` |
| Lots de dépôt | 19 | 19 | `60f289614ca4707573d6aac8e3582f4bd230f1e0a7f1796f06feb9d2a50e4031` |
| Briefs | 9 | 9 | `963543286e4e535c0671092e29e773317d7118903efb04699b0f70b3a3e5f8c7` |
| Mandats des demandes de métré, selon le calcul du [reçu précédent](shared-supabase-takeoff-brief-plan-choice-2026-11-25.md) | 2 | 2 | `ac1231862d30b1b48bfabe8db9f1213858f11f6f14617f972038d95b90cc64e2` |

À 03:06:31 UTC, puis à 03:07:14 UTC, les deux demandes étaient closes (une automatique, une manuelle). Les trois analyses comptaient un succès et deux échecs. Aucune demande n’était en évaluation ou admise, et aucun lot ni aucune analyse en état non final n’avait été modifié dans les dix minutes précédant chaque lecture. Aucune analyse n’a démarré. Le rattrapage prévu par la migration comptait zéro affaire éligible avant application. Les nouvelles tables privées `affaire_intake_contracts` et `affaire_intake_launch_selections` contenaient chacune zéro ligne après application.

## Catalogue et droits

- Les quatre corps de fonction remplacés correspondaient aux sources précédant #559. Après application, les 17 définitions de corps du fichier concordent avec le catalogue. La fonction historique de lecture des entrées, déplacée dans `private`, et la surcharge de lancement à deux arguments ont conservé leurs corps.
- Les trois tables privées réservent les privilèges à leur propriétaire. Les rôles d’API ne peuvent exécuter aucune des fonctions privées contrôlées. Les droits d’exécution des fonctions publiques correspondent aux attributions de la migration. Toutes les fonctions `SECURITY DEFINER` contrôlées fixent un `search_path` vide.
- Les six nouveaux déclencheurs sont activés, dont trois sur les lots, deux sur les documents et un sur `storage.objects`. Le rôle de migration disposait du privilège `TRIGGER` sur cette dernière table, où les sept déclencheurs applicatifs ou Storage préexistants sont toujours présents.
- La définition installée de `lock_intake_plan_original` filtre sur le bucket `affaire-intake` lors d’une insertion ou d’une mise à jour de `name` ou `bucket_id`. Les écritures dans les autres buckets et les changements de métadonnées seuls passent hors du déclencheur. Dans le bucket visé, seul un chemin d’original correspondant à un plan classé et disponible dans une affaire sous contrat actif peut verrouiller une pièce. Ce contrôle repose sur le catalogue et le corps SQL installé.
- Les deux index partiels `intake_available_original_path` (documents) et `intake_plan_decisions_by_project` (événements) sont valides et prêts.

## Santé et nouveaux avis Supabase

Le point de santé de production a répondu HTTP 200 avant et après application, avec la version 0.9.0 et la base disponible. [Santé de production](https://hex-bc.vercel.app/api/health)

L’advisor de sécurité ajoute trois avertissements pour des fonctions `SECURITY DEFINER` exécutables par `authenticated`. La migration accorde explicitement ces droits. `intake_current_brief_active()` expose le booléen de bascule. `prepare_historical_intake_document_retry(uuid, uuid)` contrôle la bascule et les droits sur l’affaire. La surcharge à quatre arguments de `start_affaire_intake_analysis` passe par le lancement existant pour réserver l’analyse. [Avis Supabase sur les fonctions exécutables](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

L’advisor de performance signale les deux index partiels nouvellement créés comme encore inutilisés lors du contrôle. [Avis Supabase sur les index inutilisés](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
