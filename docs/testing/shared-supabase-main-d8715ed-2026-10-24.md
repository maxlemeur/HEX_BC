# Migrations des PR #95, #97 et #92 sur le Supabase partagé — 24/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Trois migrations appliquées et vérifiées avant le déploiement de `main` à `d8715ed`. `anon` n'exécute plus que les deux fonctions SECURITY DEFINER propres au partagé ; la provision FO est en place, sans changer aucune ligne existante. Aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `d8715ed` (fusion de la [PR #97](https://github.com/maxlemeur/HEX_BC/pull/97)). Autorisation permanente du porteur du 24/10 pour les migrations fusionnées ; pour `20261024142907`, application liée au déploiement de `main`, feu vert du porteur à 16:30 UTC.

## Migrations appliquées

| Migration | PR | Octets | SHA-256 (fichier = manifeste = instruction enregistrée) | Version distante | Application (UTC) |
|---|---|---|---|---|---|
| `20261024153743_restrict_template_insert_execute.sql` | #95 | 569 | `cd4df4fd49ec1f895906eae4031ece272f158e7e933e9e5ff39b1aa3c8fa124c` | `20261024163049` | 24/10/2026 16:30:49 |
| `20261024153906_restrict_anon_security_definer_execute.sql` | #97 | 2 181 | `fea36ebe8a395d65755a5ee9d39598af5a485928cb96831078b13b23ffefe7f7` | `20261024170050` | 24/10/2026 17:00:50 |
| `20261024142907_estimate_fo_provision.sql` | #92 | 27 680 | `bff5a97596e1555829b0f6a0ff8c95d2463a437bca0f9d4cb0f71be5999cf2b8` | `20261024170214` | 24/10/2026 17:02:14 |

Contenu extrait par `git show` des commits de fusion (`1499ac08`, `d8715edc`, `f293ea5e`), SHA-256 identiques au [manifeste](../../supabase/migrations.manifest.json), transmis complet à `apply_migration` du MCP Supabase, dans l'ordre de fusion. Pas de `supabase db push`. Les versions distantes sont des heures d'application ; `20261024142907` passe donc après les deux autres dans l'historique, sans dépendance entre elles.

- `20261024153743` : appliquée depuis la session du Mac du porteur. `20261024153906` y a été refusée avant envoi par le classifieur du mode auto, puis appliquée depuis ce fil cloud à la demande du porteur.
- `20261024142907` : l'appel de ce fil a répondu `42701 column "default_fo_provision" ... already exists`, alors que la ligne d'historique porte 17:02:14, soit pendant cet appel. Aucune autre session connue ne l'a appliquée (la session du Mac le confirme), ce qui désigne vraisemblablement une seconde tentative du connecteur après une première exécution réussie. L'erreur porte sur la première instruction de cette seconde tentative, qui n'a donc rien changé : une seule application, une seule ligne d'historique, instruction enregistrée au SHA exact.

## Préflight en lecture seule

- Historique : **320 lignes**, dernière version `20261024151245` ; les trois noms absents, revérifiés avant chaque application.
- `20261024153743` : `insert_estimate_template_into_version(uuid,uuid,uuid)` SECURITY INVOKER, ACL `{=X,postgres=X,anon=X,authenticated=X,service_role=X}`.
- `20261024153906` : les 16 fonctions présentes, toutes SECURITY DEFINER avec `anon=X` ; 15 ont aussi `=X` (PUBLIC), `log_estimate_batch_audit` seulement `anon`. Aucune policy pour `public` ou `anon` n'appelle ces aides.
- `20261024142907` : colonnes, fonction et déclencheur absents ; `estimate_v3_read_item`, `estimate_v3_canonical_input`, `duplicate_estimate_version_without_product_id` et `read_estimate_version_items` présentes ; 7 types de fourniture, dont 2 (`tube`, `calorifuge`) visés par le passage à 1,030 ; 3 380 lignes, 17 versions v3.

## Après application

- Historique **320 → 323 lignes**, une ligne par nom ; empreinte des 320 lignes antérieures inchangée (`b0f1320b04942a95028306efa4e72268`).
- Droits : `insert_estimate_template_into_version` et les 16 fonctions de `20261024153906` ont l'ACL `{postgres=X,authenticated=X,service_role=X}` ; `anon` false, `authenticated` true, `service_role` true pour les 17 ; plus aucune entrée PUBLIC. Corps de `insert_estimate_template_into_version` inchangé (MD5 `8bf2070fec1c8fbbdf6ad881ca9208a4`).
- Provision FO : `supply_types.default_fo_provision` NOT NULL défaut 1,010, `estimate_items.fo_provision` nullable sans défaut, contraintes `supply_types_default_fo_provision_check` et `estimate_items_fo_provision_check` validées. `tube` et `calorifuge` à 1,030, les 5 autres types à 1,010. Les **3 380 lignes** sont à 1,000.
- `private.derive_estimate_item_fo_provision()` : SECURITY DEFINER, `search_path=""`, propriétaire `postgres`, ACL `{postgres=X}` ; déclencheur `ad_derive_estimate_item_fo_provision` BEFORE INSERT OR UPDATE sur `estimate_items`, actif. Les trois fonctions remplacées lisent `fo_provision` et gardent leur ACL `{postgres=X}`.
- Conseillers de sécurité : SECURITY DEFINER exécutable par anon **18 → 2**, il reste `set_estimate_explanation_scope_defaults()` et `set_estimate_explanation_source_scope_defaults()`, propres au partagé ; exécutable par authenticated 67 inchangé ; 19 RLS sans policy et 1 protection des mots de passe divulgués inchangés.

## Limites

Aucun appel métier des fonctions modifiées sur le partagé et aucun déploiement dans ce reçu. Le code déployé avant ces migrations était `0cdfdb0` ; le déploiement de `d8715ed` est fait à part par le porteur. Les preuves fonctionnelles restent celles des PR #92, #95 et #97. [Rapport JSON](./shared-supabase-main-d8715ed-2026-10-24.json).
