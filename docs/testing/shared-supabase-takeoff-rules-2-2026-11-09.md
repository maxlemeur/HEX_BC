# Règles du métré sur le Supabase partagé — reçu 2 du 09/11/2026

> Reçu daté pour le garde des migrations appliquées. Procédure : [Supabase](../../supabase/README.md#appliquer-sur-une-base-partagée). Ce reçu complète le [reçu du 5 novembre](./shared-supabase-takeoff-rules-2026-11-05.md).

**Les cinq migrations de `20261105020000` à `20261108212717` sont enregistrées et vérifiées sur `ijropnynpwjbllievrip` (`bon_de_commande`), base partagée qui sert aussi la production. Les deux dernières ont été appliquées le 9 novembre avec confirmation humaine. Les trois précédentes n'ont pas été rejouées.**

Sources vérifiées : `main` à `0a7afd35a2fb6d6a69b90f6e06e3300a7d2c460c`. Les cinq fichiers correspondent au manifeste. Aucun fichier SQL n'a été modifié. Les contrôles n'ont écrit aucune donnée métier ; aucun déploiement ni activation de `MERGEONE_TAKEOFF_RULES` n'a été effectué.

## Migrations et instructions enregistrées

| Migration canonique | Version distante | Octets du fichier / enregistrés | Comparaison |
|---|---|---|---|
| [`20261105020000_takeoff_rule_decisions`](../../supabase/migrations/20261105020000_takeoff_rule_decisions.sql) | `20261106000131` | 29466 / 29466 | Fichier complet, saut final inclus |
| [`20261106233931_takeoff_complete_failure_identities`](../../supabase/migrations/20261106233931_takeoff_complete_failure_identities.sql) | `20261107181419` | 15912 / 15911 | Fichier sans son seul saut final |
| [`20261107082522_takeoff_rules_recovery`](../../supabase/migrations/20261107082522_takeoff_rules_recovery.sql) | `20261107181440` | 3754 / 3753 | Fichier sans son seul saut final |
| [`20261107123425_takeoff_network_material_decisions`](../../supabase/migrations/20261107123425_takeoff_network_material_decisions.sql) | `20261109101736` | 15345 / 15344 | Fichier sans son seul saut final |
| [`20261108212717_takeoff_protective_quantities`](../../supabase/migrations/20261108212717_takeoff_protective_quantities.sql) | `20261109101840` | 18583 / 18582 | Fichier sans son seul saut final |

Chaque nom possède une seule ligne d'historique et une seule instruction enregistrée. SHA-256 des instructions :

- `20261105020000_takeoff_rule_decisions` : `42bd3ca5e218cc18abba04e1ab3656fb2cf198a0912d076d984863fa9a5b2ba8`.
- `20261106233931_takeoff_complete_failure_identities` : `fbe761f20dc5c6f9bc27a386a56ad08995d62a70a9f8bc2b174ac4ce1ddf01d4`.
- `20261107082522_takeoff_rules_recovery` : `ab56a9c2d781fbaf3c72855eb35060a455baf4c43ec7a1463c7acf67bd508f2f`.
- `20261107123425_takeoff_network_material_decisions` : `41bfda82d2dacb14e93e874170d469a04c0515254fdd1bf64603568a10d19f8e`.
- `20261108212717_takeoff_protective_quantities` : `edff5c3fdd9acb000f04c9b0ae21690d8929e58217b420a6d46d6546f3e38073`.

Les empreintes des fichiers complets, les dates et les versions figurent dans le [reçu JSON](./shared-supabase-takeoff-rules-2-2026-11-09.json).

- `20261105020000` : application par une autre session le 6 novembre, preuve historique dans `outputs/supabase-apply-20261105/results.json`, entrée `fourth` ; texte enregistré vérifié à nouveau le 9 novembre.
- `20261106233931` et `20261107082522` : applications du 7 novembre, preuves privées reconstituées le 9 novembre ; texte enregistré vérifié à nouveau le 9 novembre. Les contrôles de catalogue manquants ont été effectués dans cette reprise.
- `20261107123425` : première tentative du 9 novembre expirée sans changement de la base, puis relance explicitement autorisée et confirmée ; application à **10:17:36 UTC**.
- `20261108212717` : application à **10:18:40 UTC** avec ses propres `begin;` et `commit;`, inchangés. Le texte enregistré fait exactement 18 582 octets et possède le SHA-256 attendu.

## Contrôle préalable

- Historique : **358 lignes**, dernière version `20261107181440` ; les deux migrations autorisées étaient absentes.
- `takeoff_items.verification_justification`, `validate_takeoff_rule_acceptance()` et `takeoff_dpgf_review_decisions.quantity_snapshot` étaient absents.
- MD5 de `pg_get_functiondef(audit_takeoff_item_decisions())` : `0f3a19134f6e1e25a7cafb336120e8cb`, préfixe attendu `0f3a1913`.
- Empreintes, signatures, droits et configurations des fonctions remplacées relevés avant application ; valeurs conservées dans le JSON.
- Comptages exacts à zéro : jobs, lignes, géométries, pages vectorielles, liens DPGF, décisions de revue DPGF, autorisations d'application et preuves internes. Aucun job terminé ni ligne réseau à rendre obsolète.

## Contrôles après application

À **10:20 UTC**, l'historique contient **360 lignes**. **51 vérifications du catalogue et des droits : OK**.

- Les **18 corps de fonctions** définis ou remplacés par ces cinq migrations correspondent octet par octet aux définitions finales du dépôt, par SHA-256 de `pg_proc.prosrc`. La surcharge à quatre arguments d'`apply_takeoff_job_guarded_atomic` conserve son MD5 `8b72d974…`.
- Les deux colonnes nouvelles sont présentes, de type `jsonb`, nullables.
- Les triggers d'audit, de motif d'exclusion, de validation technique et d'invalidation après application sont présents et actifs. Le trigger d'audit inclut le changement de `verification_justification`. Les définitions complètes figurent dans le JSON.
- Aucun des points contrôlés n'accorde EXECUTE à `PUBLIC` ou `anon`. Les surcharges de revue et d'application gardent leurs droits prévus pour `authenticated` et `service_role`. Les helpers et le writer restent réservés à `service_role` ; les fonctions de trigger internes conservent les restrictions prévues par les fichiers.
- `takeoff_internal` : usage refusé à `PUBLIC`, `anon` et `authenticated`, accordé à `service_role`. La table `rule_failure_proofs` a la RLS active, sans politique client ; seuls les droits CRUD prévus sont accordés à `service_role`.
- RLS active et forcée sur `takeoff_jobs`, `takeoff_items` et `takeoff_vector_pages`.
- Les huit tables comptées restent vides après application. Les mises à jour d'invalidation n'ont touché aucune ligne.

**17 cas synthétiques en lecture seule : OK**, à **10:21 UTC** : entrée non-tableau, passage ignoré, identifiants partenaires en minuscules, apparition/disparition d'échec, identité du contexte de quantité et réouverture sur changement, preuve complète de groupe tronqué, preuve manquante ou empreinte erronée rejetée, égalité/inégalité des identités d'override et digest complet, sonde de reprise et empreinte d'une version absente. Chaque résultat attendu et observé est conservé dans le JSON.

## Avis de sécurité

Le contrôle frais avant application et celui après application portent les mêmes identités de constats :

| Avis | Référence du 7 novembre | Avant / après cette application |
|---|---|---|
| [INFO RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 24 | 25 / 25 |
| [WARN fonctions SECURITY DEFINER exécutables par authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | Référence complète du 5 novembre : 70 | 70 / 70 |
| [WARN protection contre les mots de passe divulgués désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | Référence complète du 5 novembre : 1 | 1 / 1 |

L'INFO supplémentaire par rapport au précontrôle du 7 novembre est `takeoff_internal.rule_failure_proofs`, créée par `20261106233931`, déjà appliquée le 7 novembre **après** cette référence. Son absence de politique client et ses droits correspondent au SQL prévu. Aucun constat nouveau entre le précontrôle frais et les deux applications du 9 novembre. Les avertissements préexistants ne sont pas corrigés par ce lot.

## Portée et preuves

Les preuves privées sont dans `outputs/supabase-apply-20261107/results.json` (précontrôle, requêtes SQL exactes, fonctions, checks, cas, tentatives et résultats). Ce répertoire reste hors commit. Le JSON de ce reçu conserve les identités, empreintes, résultats et limites nécessaires sans donnée d'affaire ni identité personnelle.

Ces contrôles du partagé ne constituent pas une nouvelle exécution des suites applicatives locales, ni un parcours authentifié d'écriture ou d'application atomique. Les triggers et frontières de droits sont vérifiés par catalogue et comparaison exacte des corps ; aucun jeu de données n'a été créé sur le partagé. Les résultats historiques sont réutilisés avec leur date, et ne sont pas présentés comme des exécutions neuves.

La configuration effective du flag n'a pas été relue dans les environnements de déploiement : ce reçu atteste l'absence d'activation **par cette opération**. Aucun autre DDL ni déploiement n'est inclus. Une fusion de cette PR de documentation ne constitue pas un déploiement.
