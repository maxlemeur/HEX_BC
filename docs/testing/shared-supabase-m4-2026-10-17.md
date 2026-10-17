# Application de M4 au Supabase partagé — 17/10/2026

**M4 appliquée et vérifiée. Aucune politique d'entreprise posée, aucune version v3 créée, aucune donnée applicative insérée et aucun déploiement.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source immuable : `main` à `94694ab340020aa31dfdb6acbbf7549c20957ab5`, après fusion de la PR #33.

| Source exacte | Version distante générée | Méthode |
|---|---|---|
| `20261017162000_estimate_engine_v3_persistence.sql` | `20261017210207` | `apply_migration` |

Le fichier complet de 198 064 octets a été transmis sans modification. SHA256 : `3932bd156e2c1c02ff4f69cc71d395622412a3baa2baf90b32b64b11dcc4af1c` ; blob Git du fichier local et de la source : `c4802fd69d9845c0d3acf2babf5fdcdf30788a3a`. Aucun `supabase db push`.

## Préconditions en lecture seule

La requête demandée sur les sections a été exécutée **avant toute autre opération**, puis répétée juste avant application : **0 section non conforme** à la règle atelier/chantier canonique. Aucune correction de ligne n'a été nécessaire ni effectuée.

Le catalogue et l'historique confirmaient également :

- les objets requis de M3 présents ;
- les deux tables de politique et les 12 nouvelles colonnes absentes ;
- aucune version `calc_engine_version = 3` ;
- aucune application antérieure de M4, y compris sous un autre nom au vu des objets absents.

La revue indépendante en lecture seule du fichier exact n'a trouvé aucun blocage : 92 instructions de préflight/DDL/droits/commentaires et aucun DML au niveau supérieur. Les écritures contenues dans les nouveaux corps de fonctions ne sont pas exécutées par la migration.

## Répétition locale et chaîne canonique

Sources du SHA ci-dessus, sous WSL Ubuntu 24.04, Node 24.14.0, Supabase CLI 2.120.0 et PostgreSQL 17.11, dans des piles natives temporaires isolées :

1. Construction du schéma canonique complet et de ses oracles de catalogue.
2. Construction du socle sans M4 ; reproduction **locale uniquement** des deux variantes historiques de contraintes décrites dans le [rapport de rattrapage](./shared-supabase-catch-up-2026-10-17.md).
3. Comparaison avec le partagé avant M4 : **zéro différence sur les 90 fonctions présentes et les 33 tables du périmètre**.
4. Application du fichier exact M4 ; comparaison au canonique ; exécution des suites pgTAP existantes.

La répétition réussit **19 fichiers pgTAP, 1 837 assertions**. Les deux piles de répétition ont été arrêtées et détruites, leurs répertoires retirés. La commande canonique `npm run db:ci:local` a ensuite terminé avec le code **0** : **1 837 assertions PASS et matrice RLS comportementale PASS** ; son cleanup isolé fait partie de la commande.

## Contrôles finaux sur le partagé

| Contrôle | Résultat observé |
|---|---|
| `tenant_calc_policies` et `tenant_calc_policy_events` | RLS active ; une politique SELECT par table, `TO authenticated`, filtrée par `is_tenant_member(tenant_id)` |
| Droits des membres | SELECT uniquement ; INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES et TRIGGER refusés à `authenticated` |
| Droits `anon` | Aucun des sept droits de table ; aucun EXECUTE sur l'écrivain de politique |
| `set_tenant_calc_policy` | EXECUTE refusé à `anon` et `authenticated`, accordé à `service_role` ; corps, `search_path` et ACL canoniques |
| Tables de politique et journal | **0 ligne dans chacune** ; aucun appel à l'écrivain |
| 12 colonnes ajoutées | **11 colonnes NULL** sur toutes les lignes d'origine ; `pricing_status = 'priced'` partout ; types/défauts/contraintes conformes |
| Versions de devis | **398 en moteur 1, 840 en moteur 2, 0 en moteur 3** |
| Sections après migration | **0 non conforme** ; contrainte canonique recréée et validée par M4 |
| Corps de M4 | **20/20** conformes directement aux corps de la source, MD5 après normalisation LF |
| Périmètre de fonctions élargi | **98/98** conformes au canonique : corps `prosrc`, `proconfig` exact, retour, volatilité, SECURITY DEFINER, STRICT, parallélisme et ACL |
| Fonctions hors M4 protégées | **78/78** inchangées, notamment les gardes d'émission/publication et `estimate_offer_client_items_match` |
| Métadonnées des tables | **34/35 identiques intégralement** ; 35/35 en neutralisant uniquement l'ancien nom de contrainte de PU ci-dessous |

Les droits « service_role seulement » s'entendent parmi les rôles API ; le propriétaire PostgreSQL conserve ses droits d'administration. Les privilèges effectifs sont contrôlés avec `has_table_privilege` / `has_function_privilege`, en complément des ACL et des politiques du catalogue.

Les 5 nouvelles colonnes de `estimate_versions` sont neutres sur **1 238 versions** et les 7 de `estimate_items` sur **1 305 lignes**. L'absence de politique laisse les nouvelles créations sur le moteur 2 ; aucune entreprise n'a été basculée en v3.

## Conservation des données d'origine

Les **120 tables applicatives préexistantes des schémas `public` et `private`** ont été empreintées avant et après, soit **39 683 lignes** au total : nombres de lignes et empreintes **identiques pour les 120 tables**. Les tables vides sont incluses.

Méthode : MD5 de chaque ligne sérialisée en JSONB, concaténation ordonnée de ces empreintes puis MD5 de l'ensemble, avec le nombre de lignes contrôlé séparément. Seules les **12 colonnes nouvellement ajoutées** sont retirées du JSONB pour comparer les colonnes d'origine ; aucune colonne ou ligne préexistante n'est exclue. Cela inclut les montants, horodatages, historiques et journaux applicatifs existants. Les deux nouvelles tables sont vérifiées vides séparément. Les schémas techniques `auth`, `storage` et `supabase_migrations` ne font pas partie de cette empreinte applicative.

Aucune fixture, aucune politique de calcul et aucune donnée applicative n'ont été insérées sur le partagé. L'unique nouvelle ligne de l'historique des migrations est l'enregistrement technique normal de M4.

## Écart historique restant et incidents d'appel

La différence de règle des sections signalée avant M4 est résolue par la recréation canonique prévue dans le fichier, sans réécriture de données. La seule différence restante du périmètre est **un nom de contrainte préexistant** : `estimate_items_pu_ht_check` sur le partagé, `estimate_items_pu_ht_cents_check` dans le canonique. Le prédicat `pu_ht_cents IS NULL OR pu_ht_cents >= 0` est identique. M4 ne nomme ni ne modifie cette contrainte ; elle n'a pas été renommée à côté de la migration.

Deux premiers appels MCP ont renvoyé `Invalid or expired requestState`. Les lectures suivantes confirmaient l'absence des objets M4 ; l'historique était inchangé après le premier échec. Le troisième appel du même fichier exact a réussi, suivi de tous les contrôles ci-dessus. Une seule application est enregistrée, sans doublon.

## Conseillers de sécurité et limites de preuve

| Diagnostic | Avant | Après |
|---|---:|---:|
| RLS active sans politique (INFO) | 17 | 17 |
| SECURITY DEFINER exécutable par `anon` (WARN) | 18 | 18 |
| SECURITY DEFINER exécutable par `authenticated` (WARN) | 61 | 62 |
| Protection des mots de passe divulgués (WARN) | 1 | 1 |

L'avertissement authentifié supplémentaire correspond à la passerelle M4 `estimate_v3_assert_draft_for_writer`, protégée par le contrat d'écrivain ; les ACL et corps sont ceux de la source. Voir les diagnostics officiels [RLS sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) et [fonctions SECURITY DEFINER authentifiées](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Aucun droit n'a été élargi hors du fichier autorisé.

La preuve de filtrage RLS repose sur les assertions comportementales locales exécutées et l'identité des politiques/droits du partagé avec cet oracle. Aucun jeu de données n'a été créé sur le partagé pour un test RLS peuplé. Cette opération ne constitue pas une recette UI/PDF/courriel de production, ni une activation du moteur 3. **Aucun déploiement, aucune application de M5.**

## Preuves

Revue finale indépendante en lecture seule des deux rapports et des preuves brutes : **aucun constat actionnable** ; les 26 SHA256/tailles, corps sources, comparaisons et limites publiées ont été revérifiés, sans secret détecté.

- [Rapport structuré avec empreintes avant/après et comparaisons](./shared-supabase-m4-2026-10-17.json).
- [Source M4 immuable](https://github.com/maxlemeur/HEX_BC/blob/94694ab340020aa31dfdb6acbbf7549c20957ab5/supabase/migrations/20261017162000_estimate_engine_v3_persistence.sql).
- Requêtes, harnais et snapshots détaillés locaux : `.e2e/shared-supabase-m4-20261017/`. Le JSON contient leurs SHA256, les 120 comparaisons de données, les 98 comparaisons de fonctions, les 20 comparaisons directes aux corps sources et les contrôles de droits/colonnes.
