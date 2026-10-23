# Application de M5 (2.7) au Supabase partagé — 18/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).


**M5 est appliquée et vérifiée. Aucune donnée applicative n'a changé. Aucune politique de calcul n'a été posée et rien n'a été déployé.**

Projet : `ijropnynpwjbllievrip`. Source immuable : `main` à `b905ca26b405ef734de3bdae14acda139f128bc2`, fusion de la PR #45 (sous-lot 2.7) le 18/10/2026 à 18:40 Europe/Paris.

| Source exacte | Octets | SHA-256 (= manifeste sur `main`) | MD5 | Blob Git | Dernier commit du fichier | Version distante |
|---|---|---|---|---|---|---|
| `20261018102840_estimate_offer_client_contract_v2.sql` | 79 790 | `d0a799c095fdc5b9efef2ab13cf9d13e871877fe03b355f1337d7a27ed32c84f` | `33f299d0262eddbbda9324a376c1f10d` | `9e2bd712` | `cab86923` (restamp seul) | `20261018165014` |

Le restamp `20261017213500` → `20261018102840` n'a changé que le nom : octets, SHA-256 et blob sont ceux du kit préparé et qualifié localement sur `3d78d662`.

Méthode : `apply_migration` du MCP `supabase_miaouffrage`, nom `20261018102840_estimate_offer_client_contract_v2`, une seule tentative, réussie (16:50:14 UTC, 18:50:14 Europe/Paris). Aucun `supabase db push`, aucun SQL de correction, aucune écriture de données.

**Transmission à l'octet près :** l'historique distant conserve M5 en une seule instruction de **79 790 octets**, MD5 `33f299d0262eddbbda9324a376c1f10d`, égal au fichier. Les caractères non ASCII (`⇔`, `« »`, `−`, `→`) sont intacts.

Autorisation : le 18/10/2026, le porteur a autorisé l'application des migrations du lot 2 après la fusion de leur PR, selon ce protocole. Ni politique de calcul ni déploiement.

## Contenu de M5

- Préflight `LOT2_2_7_PREFLIGHT` (M1, M3, M4 présentes ; aucun objet du contrat 2 ; CHECK de paire égal à la définition revue ; aucun document sur une version moteur 3).
- `estimate_documents_client_contract_pair_check` remplacée par `client_contract_version in (1, 2)`, posée `NOT VALID` puis validée.
- Quatre fonctions nouvelles : `estimate_offer_engine_client_contract`, `estimate_offer_client_valid_v2`, `estimate_offer_client_items_match_v2`, `freeze_estimate_v3_document_snapshot`.
- Onze fonctions remplacées : `estimate_offer_document_valid`, `guard_estimate_document_engine_v3`, `guard_estimate_offer_document`, `publish_estimate_pdf_generation`, `reserve_estimate_email_dispatch`, `prepare_estimate_email_dispatch`, `transition_estimate_version_status`, `claim_portal_estimate_decision`, `assert_estimate_offer_dispatch_proof`, `guard_estimate_offer_seal`, `require_fresh_v2_snapshot_for_publication`.
- Droits révoqués/accordés à l'identique ; aucune colonne, aucun déclencheur, aucun index, aucun DML de premier niveau.

## Préconditions en lecture seule (16:44–16:46 UTC)

| Contrôle | Résultat |
|---|---|
| Historique | 303 migrations ; dernière `20261018093005_serialize_estimate_draft_lock_acquisition` (verrou de brouillon, la plus récente avant M5) ; M1, M3, M4, M7, 2.6, M6, M6b présentes ; aucune ligne M5 sous aucun nom |
| Préflight M5 rejoué | 23/23 contrôles PASS : dépendances M1/M3/M4 présentes, 17 fonctions appelées présentes, 0 objet du contrat 2, CHECK de paire = définition M1 revue et validée, 0 document sur v3, 0 ligne violant la nouvelle paire |
| Catalogue du périmètre vs oracle canonique avant M5 | **28/28 fonctions identiques** (11 remplacées + 17 appelées : corps `prosrc`, arguments, retour, langage, propriétaire, `proconfig`, SECURITY DEFINER, volatilité, STRICT, parallélisme, leakproof, ACL, commentaire) ; `estimate_documents` (colonnes, contraintes, index, déclencheurs, politiques, ACL), déclencheurs des fonctions remplacées, colonnes et enums dépendants, privilèges par défaut : identiques |
| Données | 122 tables `public`/`private`, 39 683 lignes ; 1 238 versions dont 0 en moteur 3 ; 51 documents, tous sans contrat |

L'oracle canonique est le catalogue d'une pile locale reconstruite depuis les sources sans M5 (kit du 18/10, `3d78d662`) ; aucune migration intermédiaire (M6, M6b, verrou de brouillon) ne touche une fonction de ce périmètre.

## Vérifications après application (16:50–16:52 UTC)

| Contrôle | Résultat |
|---|---|
| Historique | 304 migrations ; une seule ligne M5, la dernière ; statement MD5/octets = fichier |
| Paire de contrat | `CHECK (... client_contract_version = ANY (ARRAY[1, 2]) ...)`, validée, égale à l'oracle canonique après M5 ; 0 ligne en violation |
| Corps | **15/15** `md5(prosrc)` égaux au texte entre les balises dollar du fichier |
| Fonctions du périmètre vs oracle canonique après M5 | **32/32 identiques** (4 nouvelles, 11 remplacées, 17 appelées), tous champs dont ACL et configuration |
| Sécurité des 15 fonctions | toutes `SECURITY INVOKER`, `search_path=""`, ACL `postgres:EXECUTE, service_role:EXECUTE` (aucune exécution pour `PUBLIC`, `anon`, `authenticated`) |
| Fonctions appelées | 17/17 inchangées par rapport au partagé avant |
| Hors périmètre | 400 fonctions, 121 relations (hors `estimate_documents`), `estimate_documents` hors paire, 23 enums : empreinte globale `b9d0c974…` identique avant/après |
| Déclencheurs exécutant une fonction remplacée | identiques avant/après |
| Données | 122 tables, **39 683 lignes**, empreinte totale `555cb5b6b5d53885c1e986b2581b029f` et empreinte par table identiques avant/après ; liste des 50 tables FORCE RLS inchangée |

Méthode des empreintes : identique au rapport M7 (MD5 par ligne `to_jsonb`, concaténation triée, MD5 par table puis global), lecteur `postgres` (contourne la RLS). Aucune colonne exclue : M5 n'en ajoute pas.

## Limites

- Les contrôles distants portent sur le catalogue, l'historique et les empreintes ; le comportement de M5 a été exécuté localement (kit du 18/10 : répétition canonique, pgTAP et matrice RLS de `db:ci:local`), puis par la CI de la PR #45. Aucun parcours UI, PDF, courriel ou émission v3 n'a été exécuté sur le partagé.
- Les requêtes de catalogue et de données renvoient des condensés (MD5 par fonction et par section) plutôt que les instantanés complets ; les valeurs attendues sont recalculées hors ligne depuis les oracles avec la même sérialisation `jsonb`.
- Aucune autre migration, politique de calcul ou opération de déploiement n'a été exécutée.

[Rapport structuré](./shared-supabase-m5-2026-10-18.json).
