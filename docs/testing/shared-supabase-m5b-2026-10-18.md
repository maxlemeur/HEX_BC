# Application de la suite de M5 (ordre du contrat 2) au Supabase partagé — 18/10/2026

**La migration `20261018172935_estimate_offer_client_contract_v2_order` est appliquée et vérifiée, après M5. Aucune donnée applicative n'a changé. Aucune politique de calcul n'a été posée et rien n'a été déployé.**

Projet : `ijropnynpwjbllievrip`. Source immuable : `origin/main` à `ab1e0ca33d4fac2fe543033a73393de6aacdcbfa` ; le fichier y est arrivé par la fusion de la PR #65 (`953c26f7`, suite de #45) et a été modifié pour la dernière fois par `f2031747` (restamp seul).

## Autorisation

Le 18/10/2026, le porteur a autorisé l'application des migrations du lot 2 au partagé après la fusion de leur PR, selon ce protocole (même cadre que M5). Ni politique de calcul, ni écriture de données, ni déploiement, et jamais `supabase db push`.

## Source exacte

| Source exacte | Octets | SHA-256 (= manifeste sur `main`) | MD5 | Blob Git | Dernier commit du fichier | Version distante |
|---|---|---|---|---|---|---|
| `20261018172935_estimate_offer_client_contract_v2_order.sql` | 8 974 | `3841e9ff3c679a4a16563c4a946b47c0ba6b3551d565982249d05c2bf1a30685` | `16a5ed8bfae04ed5ed4997d19d4472fe` | `d82835fb` | `f2031747` | `20261018175846` |

128 lignes, fins de ligne LF, sans tabulation ni espace insécable ; caractères non ASCII limités à `é è ê à § « »`.

Le fichier redéfinit une seule fonction, `public.estimate_offer_client_items_match_v2(jsonb, public.estimate_versions)`, créée par M5 et jamais redéfinie depuis. En plus des contrôles de M5, elle exige que les lignes du contrat client 2 suivent le parcours préfixe de l'arbre stocké et que chaque section porte le numéro qui en découle (§13.14 de `docs/testing/estimate-engine-v3-2.7.md`). Le fichier remplace aussi le commentaire de la fonction et repose ses droits (`revoke` de `PUBLIC`, `anon`, `authenticated` ; `EXECUTE` pour `service_role`). Il n'ajoute ni table, ni colonne, ni contrainte, ni déclencheur, et n'écrit aucune donnée.

## Préconditions en lecture seule (17:57 UTC)

| Contrôle | Résultat |
|---|---|
| Historique | 305 migrations ; dernière `20261018170351_complete_estimate_insertion_receipts` (version distante `20261018172141`) ; M5 présente une fois (`20261018165014`, 79 790 octets, MD5 `33f299d0…`) ; aucune ligne de la cible sous aucun nom ni version |
| Fonction remplacée | Une seule signature. Corps `md5(prosrc)` `f6bf942f7dcfb7b16fd55003956c90b7` (4 090 octets), égal au corps de M5 dans le dépôt et à la valeur relevée après M5 ; commentaire égal à celui de M5 (`b9e521e9…`) ; `plpgsql`, `stable`, `SECURITY INVOKER`, `search_path=""`, propriétaire `postgres`, ACL `postgres:EXECUTE, service_role:EXECUTE` |
| Appelant | Seule `publish_estimate_pdf_generation` appelle la fonction ; inchangée par le fichier |
| Catalogue hors périmètre | 416 autres fonctions `public`/`private` (`f87082f9e87ff93613caad719fffb795`), 122 relations (`1f9bc0f5a8417bf351a0a45509af223a`), 23 enums (`5e343bfeed6aa2ef80b2bd41c6f78eaa`) |
| Données (17:57:44 UTC) | 122 tables, **39 683 lignes**, empreinte totale `555cb5b6b5d53885c1e986b2581b029f` (identique à celle d'après M5), 50 tables FORCE RLS ; 1 238 versions dont 0 en moteur 3 ; 51 documents, aucun en contrat 2 |

Le préflight du fichier (`LOT2_2_7_ORDER_PREFLIGHT` : fonction présente, `SECURITY INVOKER`, `search_path` vide) était donc satisfait.

Méthode des empreintes : identique au rapport M5 (MD5 par ligne `to_jsonb`, tri `collate "C"`, MD5 par table puis global), lecteur `postgres` (contourne la RLS), aucune colonne exclue. Catalogue : une ligne par fonction (corps, arguments, retour, langage, propriétaire, `proconfig`, SECURITY DEFINER, volatilité, STRICT, parallélisme, leakproof, ACL, commentaire) et par relation (type, RLS, propriétaire, ACL, colonnes, contraintes, index, déclencheurs, politiques, vue, commentaire), triées puis condensées.

## Application

`apply_migration` du MCP `supabase_miaouffrage`, nom `20261018172935_estimate_offer_client_contract_v2_order`, contenu exact du fichier, une seule tentative, réussie à 17:58:46 UTC (19:58:46 Europe/Paris), version distante `20261018175846`. Aucun `supabase db push`, aucun SQL de correction, aucune écriture de données.

## Vérifications après application (17:59–18:00 UTC)

| Contrôle | Résultat |
|---|---|
| Historique | 306 migrations ; la cible une seule fois, en dernière ligne ; une instruction de **8 974 octets**, MD5 `16a5ed8b…`, égale au fichier (caractères non ASCII intacts) |
| Corps | `md5(prosrc)` `29d3c1e00b89d3754e1c165c816d6aa9` (5 313 octets), égal au texte entre les balises dollar du fichier et à celui extrait de l'instruction stockée |
| Commentaire | MD5 `2b09349523b47c0c780488fa3148f543`, égal au texte du fichier |
| Métadonnées et droits | Inchangés : une seule signature, `boolean`, `plpgsql`, `stable`, `SECURITY INVOKER`, `search_path=""`, propriétaire `postgres`, ACL `postgres:EXECUTE, service_role:EXECUTE` (aucune exécution pour `PUBLIC`, `anon`, `authenticated`) |
| Appelant | `publish_estimate_pdf_generation` : définition complète identique à avant |
| Hors périmètre | 416 fonctions, 122 relations, 23 enums : empreintes identiques à avant |
| Données (17:59:37 UTC) | 122 tables, **39 683 lignes**, empreinte totale `555cb5b6…` et empreinte des tables `c43d8444…` identiques ; liste des 50 tables FORCE RLS inchangée |
| Exécution | `estimate_offer_client_items_match_v2('{}', null)` renvoie `false` (lecture seule) |

## Limites

- Le comportement de l'ordre et des numéros n'a pas été exécuté sur le partagé : il n'y a aucune version en moteur 3 ni aucun document en contrat 2. Il repose sur `supabase/tests/database/estimate-offer-contract-v2.test.sql` (F27-20, F27-21), `db:ci:local` et la CI de la PR #65, dont `calc-v3` (run 39150833547, `emission-v3` compris), non rejoués ici.
- Un document déjà publié garde sa copie (aucune ligne réécrite) ; il n'en existe aucun en contrat 2 sur le partagé.
- Les empreintes comparent deux instants (17:57:44 et 17:59:37 UTC) ; elles prouvent l'égalité de l'état observé, pas l'absence d'écriture entre les deux.
- Aucun parcours UI, API ou TesterArmy n'a été exécuté sur le partagé, et rien n'a été déployé. Aucune autre migration, politique de calcul ou opération de déploiement n'a été exécutée.

[Rapport structuré](./shared-supabase-m5b-2026-10-18.json).
