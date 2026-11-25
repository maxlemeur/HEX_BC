# Admission manuelle du métré · 25 novembre 2026

La base partagée a enregistré la migration à 12:08:36 UTC. Une commande manuelle vérifie désormais sous verrou que chaque plan retenu est encore la copie courante de sa pièce. [Migration](../../supabase/migrations/20261125110250_takeoff_command_current_plan_copies.sql) · [PR #572](https://github.com/thannous/HEX_BC/pull/572)

| Identité | Valeur vérifiée |
| --- | --- |
| Commit sur `main` | `8c4a33de375bec041154985e79e548f453a2d9e1` |
| Nom dans l’historique | `20261125110250_takeoff_command_current_plan_copies` |
| Version distante | `20261125120836` |
| SQL enregistré | 1 appel à `apply_migration`, 1 élément dans `statements`, 12 716 octets |
| SHA-256 du fichier et de l’élément enregistré | `f0b790b77312dac106d2e6bff72aae68a64c9856074fc62c61f42fc97ebe5288` |

## Historique et activité

| Relevé UTC | Avant · 12:08:32 | Après · 12:09:01 |
| --- | ---: | ---: |
| Entrées dans l’historique | 451 | 452 |
| Dernière version | `20261125111655` | `20261125120836` |
| Demandes de métré · `closed` | 2 | 2 |
| Analyses · `completed` | 1 | 1 |
| Analyses · `failed` | 2 | 2 |
| Demandes en évaluation ou admises | 0 | 0 |
| Analyses non finales modifiées dans les dix dernières minutes | 0 | 0 |
| Lots de dossier non finaux modifiés dans les dix dernières minutes | 0 | 0 |
| Verrous concurrents incompatibles relevés sur la table des pièces | 0 | 0 |
| Plans portant `intake_document_id` | 17 | 17 |
| Parmi eux, sans `intake_generation` / sans `intake_classified_at` | 0 / 0 | 0 / 0 |

L’empreinte des 451 entrées antérieures est identique aux deux relevés. La migration `20261124174040_material_request_original_pdfs` est absente de l’historique partagé.

## Fonctions et déclencheurs

| SHA-256 de `private.launch_manual_takeoff_command` | Avant | Après |
| --- | --- | --- |
| Définition du catalogue (`pg_get_functiondef`) | `ff933a2ad2a0521c68095a8869ca76d6b98bdde5406a43d41b0ab74541bc3867` | `6d206d825f4369b6d4ed8b9655cc559a47a88e77cb91c97be02ab38c2eebe419` |
| Corps (`prosrc`) | `054ff071cd9c4b8b7b40cef799f81a5f8e9ee249fdcea7e24b8808ec14ff8f1b` | `3977a91fbb05cf9f6de25a784969ebe46ceabd3a95135f9398818423d098b259` |

Les deux corps correspondent respectivement à la migration `20261122030312_takeoff_partial_send` et à celle de la PR #572. Les paramètres et le type de retour sont identiques aux deux relevés. Les deux fonctions privées, la commande et le déclencheur, appartiennent à `postgres`, sont `SECURITY DEFINER`, fixent un `search_path` vide et réservent `EXECUTE` à leur propriétaire.

Sur `public.affaire_intake_documents`, le nouveau déclencheur s’exécute pour chaque ligne dont au moins une des trois valeurs désignées a changé. Comme `zz_mark_takeoff_launch_document_change`, il appelle `private.mark_takeoff_launch_dossier('document')`. Cette fonction ajoute l’affaire à `mergeone.takeoff_launch_marked` via `set_config(..., true)`. Au second appel dans la transaction, `CONTINUE` précède le verrou et l’insertion, ce qui évite une seconde marque quel que soit l’ordre de ces deux déclencheurs.

Déclencheurs applicatifs de la table, triés par nom. `O` indique un déclencheur actif en mode normal.

| Nom | Moment et événements | Avant | Après |
| --- | --- | --- | --- |
| `aaa_source_review_document_scope` | BEFORE UPDATE | O | O |
| `enter_intake_launch_contract` | AFTER INSERT OR UPDATE OF upload_status | O | O |
| `guard_intake_document_deletion` | BEFORE UPDATE | O | O |
| `guard_intake_document_scope_move` | AFTER UPDATE | O | O |
| `guard_intake_launch_assignment` | BEFORE INSERT OR UPDATE OF analysis_launch_id, upload_id, id | O | O |
| `guard_intake_piece_completion` | BEFORE INSERT OR UPDATE OF analysis_launch_id, analysis_completed_at | O | O |
| `publish_waiting_intake_piece` | AFTER INSERT OR UPDATE | O | O |
| `release_reserved_intake_piece` | BEFORE UPDATE OF deletion_token | O | O |
| `restore_historical_intake_retry` | BEFORE UPDATE OF deletion_token | O | O |
| `rotate_intake_plan_copy_generation` | BEFORE INSERT OR UPDATE | O | O |
| `set_affaire_intake_document_scope` | BEFORE INSERT OR UPDATE | O | O |
| `set_affaire_intake_documents_updated_at` | BEFORE UPDATE | O | O |
| `zz_mark_takeoff_launch_copy_source_change` | AFTER UPDATE OF classified_at, file_name, source_provider | Absent | O |
| `zz_mark_takeoff_launch_document` | AFTER INSERT OR DELETE | O | O |
| `zz_mark_takeoff_launch_document_change` | AFTER UPDATE OF upload_status, classification_status, document_kind, deleted_at, deletion_token, storage_path, plan_copy_generation, issues, confidence, size_bytes, content_sha256, mime_type, drive_file_id | O | O |
| `zzz_guard_google_drive_connection_reference` | BEFORE INSERT OR UPDATE | O | O |

## Santé de production

Le point de santé a répondu HTTP 200 avant et après, en version 0.9.0, avec la base disponible. Les advisors Supabase de sécurité et de performance ont signalé zéro nouveau constat. [Santé de production](https://hex-bc.vercel.app/api/health)
