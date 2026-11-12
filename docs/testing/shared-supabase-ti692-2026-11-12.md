# TI-692 — reçu des migrations partagées et de la mise en production

Le 12 novembre 2026, les trois migrations ci-dessous ont été appliquées sur la
base Supabase partagée, qui sert aussi la production, puis le commit
`1d44b253e2fbc8085c4ffd59951265668949d78f` a été déployé en production.
Le propriétaire a explicitement autorisé ces trois fichiers, dans cet ordre,
et ce déploiement. Aucune donnée métier n’a été écrite pendant ces opérations
et leurs contrôles.

## Source et méthode

Source qualifiée et déployée : `1d44b253e2fbc8085c4ffd59951265668949d78f`.
Les fichiers étaient identiques aux blobs Git avant et après application.
La procédure suivie est [Appliquer sur une base partagée](../../supabase/README.md#appliquer-sur-une-base-partagée).
Le [reçu TI-690 livraison 3](shared-supabase-ti690-delivery3-2026-11-12.md)
précède ce lot dans l’historique distant.

| Fichier | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | ---: | ---: |
| [20261112100501_estimate_line_provisional_quantity.sql](../../supabase/migrations/20261112100501_estimate_line_provisional_quantity.sql) | `20261112191034` | 21 403 | 1 |
| [20261112142534_product_reference_check_by_index.sql](../../supabase/migrations/20261112142534_product_reference_check_by_index.sql) | `20261112191126` | 2 909 | 1 |
| [20261112152357_purchase_line_suppliers.sql](../../supabase/migrations/20261112152357_purchase_line_suppliers.sql) | `20261112191209` | 29 115 | 1 |

SHA-256 du fichier, identique à celui du SQL enregistré pour chaque migration :

- `20261112100501_estimate_line_provisional_quantity` :
  `d39751dd9fddd251ee51436bb8dade4f101b79999ca562446d9374c2327ab7b6`.
- `20261112142534_product_reference_check_by_index` :
  `d5dfe577bafaf3861e7d923c8564a9e758fdff4a445c661ed79ef37943b61bf2`.
- `20261112152357_purchase_line_suppliers` :
  `71d883ebdbae59f12da8d72446478eb94d7a95aa134d0d4dbe3de31859fdcc91`.

Un seul appel MCP `apply_migration` par fichier, avec son nom complet sans
extension et son contenu exact, UTF-8 et dernière fin de ligne inclus.
Les versions distantes correspondent aux heures d’application et diffèrent
des horodatages des fichiers. Aucun `db push`, aucune autre migration et aucun
SQL correctif hors périmètre. Les contrôles `execute_sql` étaient en lecture seule.

## Préflight et intégrité de l’historique

Avant chaque application : migration absente de l’historique, tables et
fonctions requises présentes, objets nouveaux absents. Pour les cinq fonctions
remplacées, le `md5(prosrc)` distant correspondait à la dernière définition
précédente dans les migrations : aucun correctif divergent n’a été écrasé.

| Étape | Lignes avant → après | SHA-256 avant, identique aux autres lignes après |
| --- | --- | --- |
| 1 | 388 → 389 | `431e5345d000eda55c59099b33898ce831ba9cae1c98014870d7fb5d7d8982f0` |
| 2 | 389 → 390 | `c926e29a3fee67a6e2d20b36d34ac47611d032254b5a849f71fdeca478c94ba8` |
| 3 | 390 → 391 | `6c7de79e2661badd6f08b5cc82727d80a802dc6cfe49241ab8bd22764df95a41` |

Empreinte calculée en UTF-8 par
`sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`.
L’historique final compte **391 lignes**, SHA-256
`08ae8594486ac6e04b739d3f4dfc1c0fee8b0aeb84d62e02964f8fedba5eb15e`.
Une fois les trois ajouts exclus, les **388 anciennes lignes** conservent
l’empreinte initiale `431e5345d000eda55c59099b33898ce831ba9cae1c98014870d7fb5d7d8982f0`.
La dernière entrée initiale était
`20261112121147 / 20261112101124_material_request_articles`.

Une première requête de préflight en lecture seule a échoué avec SQLSTATE
`42601` (parenthèses surnuméraires), puis a été corrigée avant toute application.
Cet échec n’a effectué aucune mutation ; aucune application n’a échoué.

## Contrôles sur la base partagée

- **Quantité provisoire** : les quatre corps de fonctions correspondent au
  fichier. Le déclencheur `af_clear_estimate_item_offer_choice` est actif sur
  INSERT et UPDATE de `pricing_status`, `source_metadata`, `offer_choice`.
  Les helpers purs sont IMMUTABLE ; parmi `anon`, `authenticated` et
  `service_role`, les deux derniers peuvent les exécuter. La RPC
  `set_estimate_line_offer_choice` reste réservée à `service_role` parmi ces
  rôles ; aucun des trois ne peut exécuter la fonction privée du déclencheur.
- **Référence article** : `public.assign_product_internal_reference()`
  correspond au fichier, reste SECURITY INVOKER avec `search_path=""` ;
  droits et propriétés inchangés. La colonne générée `reference_normalized`
  et l’index unique valide `products_tenant_reference_normalized_key` sont présents.
- **Fournisseurs des lignes d’achat** : `preferred_supplier_id` est nullable,
  sans défaut, sur `products` et `supply_types` ; les deux clés étrangères
  validées vers `suppliers` ont ON DELETE SET NULL. Deux index partiels valides
  et trois nouveaux déclencheurs sont présents. Les six corps de fonctions
  correspondent au fichier. `last_purchase_suppliers` et
  `save_supplier_catalog_item` sont SECURITY DEFINER ;
  `retain_material_request_line_suppliers` est SECURITY INVOKER. Ces trois RPC
  sont exécutables par `authenticated` et `service_role`, pas `anon`.
  Les fonctions privées sont SECURITY INVOKER, `search_path=""`, sans EXECUTE
  pour `anon` ou `authenticated`. La fonction remplacée
  `private.enforce_material_request_line_write` conserve son ACL.
- **Protections existantes** : RLS, FORCE RLS, politiques, ACL des tables et
  privilèges par défaut inchangés aux trois étapes. Aucune table créée, aucun
  objet existant retiré hormis le déclencheur recréé intentionnellement à l’étape 1.

**Réserve ACL :** les tables existantes conservent les privilèges
REFERENCES, TRIGGER et TRUNCATE de `service_role`, ainsi que les privilèges
par défaut du schéma `public`. Ce lot ne crée aucune table. Aucun SQL
hors périmètre n’a été ajouté pour modifier ces droits.

## Avis de sécurité

`get_advisors security` a été exécuté avant la première application et après
la dernière. Aucun relevé intermédiaire n’est présenté comme exécuté.

| Avis | Avant | Après |
| --- | ---: | ---: |
| [RLS active sans politique](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 24 INFO | 24 INFO |
| [SECURITY DEFINER accessible à authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 73 WARN | 75 WARN |
| [Protection des mots de passe divulgués désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 WARN | 1 WARN |

Les deux nouveaux WARN concernent `public.last_purchase_suppliers(uuid[])` et
`public.save_supplier_catalog_item(uuid,uuid,text,text,boolean)`, conformément
au fichier de la troisième migration. La comparaison hors heure d’observation
ne montre aucun autre ajout ni retrait. Les avis préexistants restent ouverts.

## Déploiement et surveillance

- Déploiement production : `dpl_CsSZxB4Ryv4SPPZWcPgfYAE1HbDQ`, **READY**,
  source Git exacte `1d44b253e2fbc8085c4ffd59951265668949d78f`, sans envoi de
  fichiers locaux. État et affectation de l’alias relus à 19:36:40 UTC.
- Qualification existante réutilisée : `npm run check:release`, exit **0**,
  Node **26.12.1**, **5 991 tests node verts et 3 skips**, build Webpack,
  TypeScript et smoke HTTP verts. Aucune nouvelle exécution dans cette étape finale.
- Surveillance du 12 novembre, **19:21:19 à 19:36:19 UTC** : **900,36 secondes**,
  16 passages, **32 requêtes sur 32 en HTTP 200** ; `/api/health` retourne
  `ok: true`, `db: up`, et le formulaire `/login` est présent à chaque passage.
  Aucun groupe de logs `error` ou `fatal` retourné pour ce déploiement depuis sa création.
- Les trois drapeaux de production sont relevés sur le ticket TI-692.
- Déploiement précédent conservé : `dpl_7o2hU9EeVANETNQALeqjJXpkDHXV`,
  SHA `a3cad6373ee21674ebaf8cd957f726c518da21dc`. Aucun retour arrière effectué.

Le build a émis un avertissement de bundling `libheif-js` sur des dépendances
non extractibles statiquement ; aucun incident constaté dans les sondes et
logs examinés. Un diagnostic DNS du sandbox, antérieur à toute réponse HTTP,
est conservé séparément et exclu des 32 requêtes qualifiées.

## Preuves, limites et reprise

Preuves privées locales, non versionnées : `outputs/ti692-production-20261112/`
(`migrations.md`, `migrations.json`, `deployment.md`, `deployment.json`,
`http-monitor.jsonl`, `flags.json`) et
`outputs/ti692-check-release-1d44b253/check-release.log`.
Ce reçu publie uniquement les identités techniques et résultats assainis.

Les contrôles prouvent le SQL appliqué, l’historique, le catalogue, les droits,
les avis et la disponibilité HTTP. Ils ne qualifient aucun parcours métier
authentifié en production : la recette authentifiée reste au propriétaire,
sur un brouillon de test. Le rouge TesterArmy Full de `main`, suivi dans
[l’issue #266](https://github.com/maxlemeur/HEX_BC/issues/266), et son diagnostic
restent consignés sur TI-692 ; les parcours Critical sont verts.

Les PR #278, #276, #280 et #279, intégrées après le SHA déployé, sont hors
production pour ce go. La migration
[20261112173255_material_request_quotes.sql](../../supabase/migrations/20261112173255_material_request_quotes.sql)
de [la PR #279](https://github.com/maxlemeur/HEX_BC/pull/279) n’a pas été appliquée.

Cette PR est documentaire : cohérence, liens et `git diff --check` seulement.
Son annulation n’annule ni les migrations ni le déploiement. Privilégier une
correction compatible en avant ; toute intervention distante supplémentaire
nécessite sa propre autorisation. Un retour applicatif doit rester compatible
avec le schéma et les données actuels.
