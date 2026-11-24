# Lancement de l’analyse du dossier · 24 novembre 2026

La migration de la [PR #537](https://github.com/maxlemeur/HEX_BC/pull/537) a été appliquée à la base partagée à **20:14:11 UTC**, sous la version distante **`20261124201411`**. Supabase a enregistré les **19 078 octets** du [fichier SQL](../../supabase/migrations/20261124182705_affaire_intake_analysis_launch.sql) en une entrée SQL, saut de ligne final compris.

| Identité | Valeur |
| --- | --- |
| Nom enregistré | `20261124182705_affaire_intake_analysis_launch` |
| Commit source sur `main` | `f1340d681aebbbfde47a693d2ed8128d681075c4` |
| SHA-256 du fichier et du SQL enregistré | `814d993104a68bdaa884790657d037a52edd22f31e696be3103e12a9de987f45` |
| Historique | 445 → 446 entrées. L’empreinte des 445 entrées antérieures est identique avant et après. |

La migration `20261124174040_material_request_original_pdfs` de la [PR #535](https://github.com/maxlemeur/HEX_BC/pull/535) figure sur `main` et est absente de l’historique partagé au moment du contrôle.

## Données et compatibilité avec la version 0.9.0

| Mesure en lecture seule | Avant | Après |
| --- | ---: | ---: |
| Dépôts et lots (`affaire_intake_uploads`) | 19 | 19 |
| Documents (`affaire_intake_documents`) | 51 | 51 |
| Briefs (`affaire_briefs`) | 9 | 9 |
| Dépôts dans un état `launch_*` | 0 | 0 |
| Documents dans l’état `awaiting_launch` | 0 | 0 |

Les lignes existantes satisfaisaient les nouvelles contraintes de statut. Aucun projet ne présentait de doublon pour l’index unique des lancements actifs. L’installation des déclencheurs ne rejoue aucune écriture sur les lignes existantes. Après application, les 19 dépôts ont `launch_read_scans IS NULL` et les 51 documents ont `analysis_launch_id IS NULL`. Avant et après, le [point de santé de production](https://hex-bc.vercel.app/api/health) a répondu HTTP 200, version 0.9.0, base disponible.

## Catalogue vérifié

Les deux nouvelles colonnes sont nullables, sans valeur par défaut. Les deux contraintes de statut sont validées et la clé étrangère du document référence le dépôt avec contrôle différé en fin de transaction. Les trois index partiels sont valides et prêts, dont l’index unique par projet. Les dix déclencheurs prévus sont activés sur les dépôts, documents et briefs.

Les corps des douze fonctions correspondent au fichier. Parmi les rôles API, seul `authenticated` peut exécuter `launch_affaire_intake_analysis`, et seul `service_role` peut exécuter `claim_affaire_intake_analysis_launch` et les deux fonctions de bail ci-dessous. Les huit fonctions privées sont réservées au propriétaire. Les trois fonctions `SECURITY DEFINER` fixent un `search_path` vide.

| Fonction remplacée | MD5 du corps avant | MD5 du corps après |
| --- | --- | --- |
| `renew_affaire_intake_upload_lease` | `5dc2c9652a67ae465efb2409a34de41a` | `1ef61b1f837d06d54c3e930b169b494c` |
| `finish_affaire_intake_upload_attempt` | `8c6bab0ba7634a76e4bc442df33e68d5` | `6368614d25c70004ab241af8777b966f` |

Les empreintes initiales correspondent à la [migration des baux](../../supabase/migrations/20260811231238_durable_workflow_recovery.sql). Le renouvellement accepte aussi `launch_processing`. La finalisation conserve la file propre aux lancements lors d’une reprise, vérifie les pièces restantes avant une clôture réussie et marque les pièces admissibles en échec si le lot échoue. Les deux signatures, propriétaires, privilèges et contrôles de jeton sont conservés.

## Nouveaux avis Supabase

- **Sécurité · 1 avertissement.** La commande de lancement est une fonction `SECURITY DEFINER` exécutable par `authenticated`, conformément au droit prévu. Elle vérifie le tenant actif, l’appartenance, le droit du propriétaire ou de l’administrateur et l’état du projet lors de la réservation. [Règle Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- **Performance · 2 informations.** Les index `affaire_intake_launch_due` et `affaire_intake_documents_launch` n’avaient enregistré aucune utilisation lors du contrôle. [Règle Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)
