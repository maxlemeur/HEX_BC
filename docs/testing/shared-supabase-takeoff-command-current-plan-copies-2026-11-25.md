# Copies de plans à l’admission du métré · 25 novembre 2026

**Application arrêtée avant toute écriture.** Le précontrôle de la [PR #572](https://github.com/thannous/HEX_BC/pull/572) attendait que le nouveau déclencheur se classe en dernier par nom sur `public.affaire_intake_documents`. Parmi les 15 déclencheurs applicatifs existants, trois noms se classent après `zz_mark_takeoff_launch_copy_source_change`.

| Déclencheur classé après celui du fichier | Événement |
| --- | --- |
| `zz_mark_takeoff_launch_document` | `AFTER INSERT OR DELETE` |
| `zz_mark_takeoff_launch_document_change` | `AFTER UPDATE OF`, notamment sur `plan_copy_generation` |
| `zzz_guard_google_drive_connection_reference` | `BEFORE INSERT OR UPDATE` |

Une instruction qui change à la fois `classified_at` et `plan_copy_generation` peut satisfaire les conditions des deux déclencheurs `AFTER UPDATE`. Celui du fichier se classerait en premier des deux. Ils appellent tous deux `private.mark_takeoff_launch_dossier('document')`.

## Identité et état de la base

| Relevé | Valeur |
| --- | --- |
| Commit fusionné sur `main` | `8c4a33de375bec041154985e79e548f453a2d9e1` |
| [Fichier SQL](../../supabase/migrations/20261125110250_takeoff_command_current_plan_copies.sql) | 12 716 octets, SHA-256 `f0b790b77312dac106d2e6bff72aae68a64c9856074fc62c61f42fc97ebe5288` |
| Historique partagé aux deux relevés | 451 entrées, dernière version `20261125111655` |
| Migration #572 | 0 appel à `apply_migration`, 0 entrée distante. Longueur et empreinte du SQL enregistré sans objet. |
| Migration #535 | Absente de l’historique partagé |
| Demandes et analyses aux deux relevés | 2 demandes `closed`, 2 analyses `failed`, 1 `completed` |
| Fenêtre calme | 0 demande en évaluation ou admise, 0 analyse et 0 lot non terminaux récemment mis à jour (10 minutes), 0 verrou concurrent incompatible observé sur la table |
| Copies avec `intake_document_id` | 17, dont 0 sans `intake_generation` et 0 sans `intake_classified_at` |

À 12:02 et 12:03 UTC, le SHA-256 de `pg_get_functiondef` pour `private.launch_manual_takeoff_command` valait `ff933a2ad2a0521c68095a8869ca76d6b98bdde5406a43d41b0ab74541bc3867`. Son corps correspond à la [migration précédente](../../supabase/migrations/20261122030312_takeoff_partial_send.sql), SHA-256 `054ff071cd9c4b8b7b40cef799f81a5f8e9ee249fdcea7e24b8808ec14ff8f1b`. Le catalogue indique une seule signature, propriétaire `postgres`, `SECURITY DEFINER`, chemin de recherche vide et droit d’exécution réservé au propriétaire.
