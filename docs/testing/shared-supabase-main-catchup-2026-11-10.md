# Rattrapage de main sur le Supabase partagé — reçu partiel du 10/11/2026

> Procédure : [Supabase](../../supabase/README.md#appliquer-sur-une-base-partagée). Référence : [reçu du 9 novembre](./shared-supabase-takeoff-rules-2-2026-11-09.md). Détails et empreintes : [JSON](./shared-supabase-main-catchup-2026-11-10.json).

**Sept migrations appliquées et vérifiées sur `ijropnynpwjbllievrip` (`bon_de_commande`), base partagée qui sert aussi la production. Le rattrapage est incomplet : la huitième application a été refusée par le contrôle automatique d’approbation ; les quatre suivantes n’ont pas été tentées.**

Source figée après `git fetch origin` : `2d8223c2b3a62abd9c8dce9157feba7a906c3b51` (`origin/main`). Les douze fichiers du lot correspondent au manifeste. Aucun fichier SQL n’a été modifié. Les contrôles sont en lecture seule et n’ont créé ni donnée métier ni fixture ; la migration d’intake modifie uniquement les métadonnées du bucket prévues par son SQL. Aucun déploiement ni activation de `MERGEONE_TAKEOFF_RULES`. Le répertoire de travail canonique et son `outputs/` n’ont pas été modifiés.

## Applications et identité du SQL

| Migration canonique | Version distante | Octets fichier / enregistrés | SHA-256 identique |
|---|---|---|---|
| [`20261109174312_duplicate_dpgf_review_quantity_snapshot`](../../supabase/migrations/20261109174312_duplicate_dpgf_review_quantity_snapshot.sql) | `20261110113528` | 1560 / 1560 | OK |
| [`20261109183432_estimate_fo_price_origin`](../../supabase/migrations/20261109183432_estimate_fo_price_origin.sql) | `20261110113716` | 111092 / 111092 | OK |
| [`20261109192026_clear_detached_fo_price_origin`](../../supabase/migrations/20261109192026_clear_detached_fo_price_origin.sql) | `20261110113837` | 6673 / 6673 | OK |
| [`20261109192610_intake_cad_originals`](../../supabase/migrations/20261109192610_intake_cad_originals.sql) | `20261110113857` | 400 / 400 | OK |
| [`20261109205839_takeoff_targeted_quantity_review`](../../supabase/migrations/20261109205839_takeoff_targeted_quantity_review.sql) | `20261110113935` | 31925 / 31925 | OK |
| [`20261110025003_atomic_create_estimate_item_keeps_unchanged_projection`](../../supabase/migrations/20261110025003_atomic_create_estimate_item_keeps_unchanged_projection.sql) | `20261110113958` | 18606 / 18606 | OK |
| [`20261110094500_takeoff_acceptance_reasons`](../../supabase/migrations/20261110094500_takeoff_acceptance_reasons.sql) | `20261110114023` | 8882 / 8882 | OK |

Chaque nom a une seule entrée distante et une seule instruction enregistrée. Le texte enregistré correspond au **fichier complet, saut final inclus**, sans réécriture. Les SHA-256 exacts, tailles et horaires UTC sont conservés dans le JSON. Les sept applications ont utilisé le connecteur `apply_migration` et son mécanisme de confirmation.

## Arrêt et solde non appliqué

Le propriétaire avait autorisé les douze migrations nommées de `origin/main` dans la demande du 10 novembre. Pour la version dépôt **`20261110094501`**, le contrôle automatique a néanmoins répondu : « This applies a schema migration to the shared Supabase database, but the trusted transcript lacks an explicit owner authorization for this exact remote migration. » L’application a été refusée. Aucun contournement ni nouvel essai ; arrêt des applications à cette première anomalie.

L’historique relu après le refus confirme l’absence des cinq versions dépôt suivantes, conservées ici comme horodatages seuls pour ne pas les enregistrer à tort comme appliquées auprès du garde de restamp :

- `20261110094501` : catégories de quantité saisie — application refusée ;
- `20261110094502` : exception du contour mesuré — non tentée ;
- `20261110094503` : provisions internes — non tentée ;
- `20261110094504` : motifs de forçage — non tentée ;
- `20261110094505` : lecture des consommations par l’administrateur — non tentée.

**TI-686 : une migration appliquée sur six.** Le motif de surface de la première migration est présent ; la correction « contour mesuré retenu », les catégories, les provisions, les nouveaux motifs de forçage et la politique de lecture restent à appliquer. Ce reçu ne permet pas de déclarer ces fonctions entièrement disponibles sur le partagé.

## Contrôles préalables et catalogue

- Historique : **360 → 367** entrées. Les douze nouvelles migrations étaient absentes au départ. Les anciens alias et lots découpés déjà présents ne sont pas rejoués.
- Avant chaque application tentée : absence de son entrée d’historique, objets nouveaux ou prérequis ciblés contrôlés, comptages exacts des neuf tables de métré. Tous les comptages sont à zéro avant et après : jobs, lignes, géométries, pages vectorielles, liens DPGF, décisions de revue, autorisations, consommations d’override et preuves internes.
- Première migration : les deux ancres de copie DPGF existent chacune une fois et `quantity_snapshot` est présent. Avant la provenance des prix : colonne, contrainte, index et helper absents. Avant intake : bucket présent et privé, type binaire absent. Le précontrôle de l’application refusée confirme l’absence des deux colonnes de saisie.
- **54 contrôles du catalogue et des droits : OK.** Les 15 corps de fonctions finaux concernés correspondent aux définitions du lot effectivement appliqué par SHA-256 de `pg_proc.prosrc`. Propriétaires, signatures, configuration, ACL et triggers figurent dans le JSON ; les attributs SECURITY DEFINER et search_path correspondent aux définitions attendues.
- Colonne `estimate_items.fo_price_origin` nullable de type `jsonb`, contrainte validée et index valide. Bucket intake privé avec `application/octet-stream`. Quatre triggers concernés présents et actifs. RLS active et forcée sur les quatre tables de métré contrôlées.
- Aucun EXECUTE à `PUBLIC` ou `anon` sur les fonctions contrôlées ; droits `authenticated` et `service_role` conformes aux writers et helpers. Les cinq migrations restantes sont absentes de l’historique ; leurs colonnes, helpers et politique nouveaux sont absents.

## Avis de sécurité

| Avis | Reçu du 9 novembre | Avant | Après |
|---|---:|---:|---:|
| [INFO RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 25 | 25 | 25 |
| [WARN fonctions SECURITY DEFINER exécutables par authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 70 | 70 | 70 |
| [WARN mots de passe divulgués](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 | 1 | 1 |

Les identités et détails des constats sont inchangés entre les deux lectures fraîches, en excluant seulement leurs horodatages d’observation. Les nombres correspondent au dernier reçu, qui ne conserve pas les identités complètes. Les avertissements préexistants restent ouverts.

## Portée de la preuve

Pas de parcours authentifié d’écriture, de test applicatif local ou de qualification de release exécuté sur cette base partagée. La preuve porte sur les applications, le SQL enregistré, les objets et droits du catalogue, les comptages et les avis ; elle ne remplace pas une qualification fonctionnelle. L’état effectif du flag dans les environnements déployés n’a pas été relu. Aucun déploiement ni activation par cette opération.
