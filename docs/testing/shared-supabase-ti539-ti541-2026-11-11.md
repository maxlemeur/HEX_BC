# Application partagée — TI-539 / TI-541 — 11 novembre 2026

Application autorisée explicitement par le propriétaire dans le fil TI-534 ; aucun déploiement public.
Source commune des trois SQL : `0a5f58e50eee39e0df409badeebd6b3c3a68965e` sur main.

| Fichier source | Version partagée réellement enregistrée | SHA256 |
| --- | --- | --- |
| 20261111144803_estimate_line_status_reason.sql | 20261111200426 | 30d7f4d6b86cc1fa71cad270735516d4908ae01d3649566cd36947886544d8ed |
| 20261111155627_estimate_line_nature_pose_only.sql | 20261111200515 | 1af827341cae5a391a87be88c23e9bfbaf9db5d41c69b4dfa7c1fd6eff00c296 |
| 20261111181152_estimate_site_cost_origin.sql | 20261111200530 | 44f20db82a1ba37b4cca6d4956ee383cfdc21499dbc8f30b436f01beeb4f38e6 |

Toutes les réponses finales apply_migration : success=true. Le premier appel TI-682 a expiré dans le connecteur avant application ; la tentative suivante a réussi.
Vérification après application : les trois noms dans schema_migrations, enum pose_only présent, colonnes status_reason/was_not_priced présentes, fonction derive... porte site et pose_only ; anon ne peut pas exécuter le déclencheur.
Advisors sécurité inchangés avant/après : 24 INFO private RLS sans policy, 70 avertissements RPC security definer authentifiées, 1 avertissement protection mots de passe. Aucune nouvelle alerte. Les résumés de qualification restent dans les sorties locales ; les droits proviennent uniquement des trois SQL exacts.

Aucune migration TI-534 appliquée. Aucun déploiement public.

Les versions enregistrées par le connecteur diffèrent des horodatages source : comparer les noms complets et les empreintes ci-dessus avant de planifier une nouvelle application. Les fichiers source appliqués restent immuables.
