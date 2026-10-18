# Application de M6 et M6b (2.8) au Supabase partagé — 18/10/2026

**Les deux migrations du sous-lot 2.8 sont appliquées et vérifiées. Aucune donnée applicative n'a changé. Aucune politique de calcul n'a été posée et rien n'a été déployé.**

Projet : `ijropnynpwjbllievrip`. Source immuable : `main` à `5cfd4a94215975f3caa122ff5f64e1192b60cc5f`, fusion de la PR #40 (tête `f00da33b`, fusionnée le 18/10/2026 à 07:42:37 UTC).

| Étape | Source exacte | Octets | SHA-256 (= manifeste sur `main`) | Blob Git | Dernier commit du fichier | Version distante |
|---|---|---|---|---|---|---|
| M6 | `20261017225906_estimate_engine_v3_entry_paths.sql` | 75 580 | `87f4a0452e9dba51b6ff4d180ad42f6aad6e8d4c52414013f793d25f34c2885a` | `64564c95` | `c28866e4` | `20261018092154` |
| M6b | `20261018013249_estimate_creation_set_based_item_effects.sql` | 56 179 | `8b4f54601e21a53b146d7306256f22c5273685e055e267ce87b149a707745dfb` | `656f4a48` | `2fb27f32` | `20261018093015` |

Méthode : `apply_migration` du MCP `supabase_miaouffrage`. Une seule tentative par fichier, chaque fichier avec son propre `begin;` … `commit;`. Aucun `supabase db push`, aucun SQL de correction, aucune écriture de données. Les SHA-256 ont été recalculés avant l'application ; ils sont égaux à ceux de `5cfd4a94` et du manifeste.

**Transmission à l'octet près :** l'historique distant conserve chaque migration en une seule instruction. Son MD5 et sa taille sont égaux à ceux du fichier :
- M6 : `159198c4539bec93f1ccf67c13444f66`, 75 580 octets ;
- M6b : `6ceba67089163633f740b0562a27b5f6`, 56 179 octets.

Les caractères non ASCII (`§`, `À classer`, `·`, `« Création atomique »`) sont donc intacts.

Heures d'application, Europe/Paris : M6 à 11:21:54 et M6b à 11:30:15, soit 09:21:54 et 09:30:15 UTC.

Autorisation : le 18/10/2026 vers 03:05, Europe/Paris, le porteur a autorisé l'application des migrations du lot 2 (2.6, M5, M6 et M6b) après la fusion de leurs PR, selon ce protocole. Ni politique de calcul ni déploiement.

## Contenu
- **M6** :
  - sept colonnes, cinq sur `estimate_template_items` (`unit_code`, `pricing_status`, trois heures par unité) et deux sur `estimate_templates` (coefficients de vente) ;
  - trois CHECK et la clé étrangère implicite `estimate_template_items_unit_code_fkey` ;
  - deux commentaires de colonne ;
  - le nouveau pont `public.estimate_v3_complete_entry_for_writer` ;
  - sept fonctions remplacées (modèles, ouvrages de bibliothèque, ouvrages générés).
- **M6b** :
  - le nouveau pont `public.estimate_creation_replay_item_effects_for_writer` ;
  - quatre déclencheurs par ligne neutralisés sous le contrat `miaouffrage.estimate_creation_atomic` ;
  - `guard_estimate_version_workflow_columns` et `persist_estimate_creation_atomic`.
- Les deux migrations ne touchent ni déclencheur ni index, n'ont aucun DML de premier niveau et ne nomment pas la contrainte de PU.

## Préconditions (avant M6)
| Contrôle | Coordinateur (09:09 UTC) | Relevé (A), 09:14 UTC |
|---|---|---|
| Ponts 1 et 9 | absents | absents |
| Lignes 2–8 et 11–15 | `before`, secdef/cfg vrais | identique |
| Ligne 10 `log_estimate_audit()` | `OTHER:178d947e9593774a0ab4536244f0e5d5` | identique |
| `tables_digest` | `402ebc8b9468aede891357b1cb68743b` | identique |
| Tables / lignes / bypass_rls / non prouvées | 122 / 39 683 / vrai / 0 | identique |
| Déclencheurs (5 tables) | — | 37, `a62fc541c833d81e83c48117c753ec04` |
| Dernière migration | — | `20261018041924` (2.6) |

Le bloc `preflight` de M6 a passé dans la transaction. `pre-m6.sql` n'a pas été rejoué dans cette étape.

### Écart accepté sur `public.log_estimate_audit()`
Le corps partagé (`178d947e…`) différait du corps `est448` du dépôt (`fbe15558…`). Le coordinateur a établi qu'ils sont identiques aux espaces et commentaires près, sans dérive de comportement. Cet agent n'a pas refait la comparaison, et l'ancien corps est maintenant remplacé. Après M6b, le corps est celui du dépôt (`4f15e16c…`).

## Après M6
| Contrôle | Résultat |
|---|---|
| Lignes 1–8 | `after`, secdef/cfg vrais ; ligne 1 acl vrai, `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| `EXECUTE` sur le pont 1 | service_role et authenticated vrais ; anon et public faux |
| Lignes 9–15 | inchangées par rapport à (A) |
| Colonnes | 7, aux types attendus |
| Contraintes | 4, présentes et `convalidated` |
| Commentaires | trois, égaux au texte du fichier |
| Tables de modèles | vides (0 ligne) |
| Empreintes des données et des déclencheurs | égales à (A) |
| Historique | une seule ligne nouvelle, `20261018092154` |

## Préconditions de M6b (09:25 UTC)
- Prérequis du `preflight` et fonctions d'appui : tous vrais.
- Colonnes manquantes : 0.
- M6 est enregistré une fois et en dernier ; M6b n'est pas enregistré.
- Pont 9 : absent.
- Six déclencheurs par ligne, tous activés (`O`).
- 0 version v3.
- Empreinte des données à 09:26 UTC : égale à (A).

## Après M6b
| Contrôle | Résultat |
|---|---|
| Lignes 1–15 | toutes `after`, secdef/cfg vrais |
| ACL | acl vrai sur les lignes 1 et 9 ; ligne 9 `{postgres=X/postgres,service_role=X/postgres}` |
| Marqueur `atomic` | atomic vrai sur les lignes 9–15 |
| `EXECUTE` sur le pont 9 | service_role vrai ; authenticated, anon et public faux |
| Commentaire du pont 9 | égal au fichier |
| Signatures | une seule par fonction |
| Empreintes des données et des déclencheurs | égales à (A) |
| `list_migrations` | M6b une fois et en dernier, `20261018093015` |

## Empreintes des données
Méthode : variante réduite de `fingerprints.sql`, celle du coordinateur.
- Périmètre : toutes les tables `r` et `p` de `public` et `private`.
- Par table : nombre de lignes et MD5 de la concaténation triée (`collate "C"`) des MD5 de `to_jsonb(row)`.
- Les sept colonnes M6 sont retirées seulement pour les deux tables de modèles, qui sont vides.
- Chaque table est réduite à rows, md5, readable et rls_applies.
- Valeurs relevées : MD5 de `tables`, `table_count`, `total_rows`, `bypass_rls` et tables non prouvées.

| Relevé | Heure UTC | Digest | Tables | Lignes | bypass | Non prouvées |
|---|---|---|---|---|---|---|
| Coordinateur | 09:09 | `402ebc8b9468aede891357b1cb68743b` | 122 | 39 683 | vrai | 0 |
| (A) | 09:14:36 | identique | 122 | 39 683 | vrai | 0 |
| Après M6 | 09:22:16 | identique | 122 | 39 683 | vrai | 0 |
| Avant M6b | 09:26:24 | identique | 122 | 39 683 | vrai | 0 |
| Après M6b | 09:30:42 | identique | 122 | 39 683 | vrai | 0 |

Déclencheurs : 37, `a62fc541c833d81e83c48117c753ec04` à 09:14:57, 09:23:17 et 09:31:43 UTC.

Hors périmètre : `auth`, `storage` et `supabase_migrations`.

## Preuve comportementale
Le comportement est prouvé en local, pas sur le partagé :
- CI de la tête `f00da33b` de la PR #40 : `rls-matrix`, `army-critical`, `quality-gate`, `Tests`, `Statique` et `smoke` réussis ; `Build` ignoré.
- Séquence A–E rejouée sur une pile locale jetable (`local-validation/run2/`).

Aucune fonction métier n'a été appelée sur le partagé, et aucun modèle ni devis v3 n'a été créé.

## Écarts préservés et limites
- Aucun comportement n'a été exécuté sur le partagé : seuls le catalogue, l'historique et les empreintes ont été contrôlés.
- Conseillers Supabase non relus.
- M5 (2.7) n'est pas appliqué. Il le sera après la fusion de la PR #45, sous son nom réhorodaté.
  - L'ordre inversé est acceptable car les objets sont disjoints.
  - À la tête `3d78d662`, M5 porte sur `estimate_documents` et sur les fonctions d'offre, de document, d'envoi, de portail et de transition ; aucune des 15 fonctions de M6/M6b ni des tables de modèles.
  - Disjonction vérifiée par les noms seulement, sur une tête non fusionnée.
- `estimate_items_pu_ht_check` reste différent de `estimate_items_pu_ht_cents_check` (même prédicat), et aucune des deux migrations ne le nomme.
- Le partagé est en PostgreSQL 17.6 (`170006`) et la validation locale en 17.11. Les définitions de contraintes analysées par PostgreSQL sont identiques.
- L'écart sur `log_estimate_audit` repose sur la preuve du coordinateur.

**Aucune autre migration, politique de calcul ou opération de déploiement n'a été exécutée.** Restent M5 (2.7, après la PR #45) et M8 (2.10, approuvée par le porteur le 18/10/2026, après la fusion de sa PR).

- [Rapport structuré](./shared-supabase-m6-m6b-2026-10-18.json)
- [Source M6](https://github.com/maxlemeur/HEX_BC/blob/5cfd4a94215975f3caa122ff5f64e1192b60cc5f/supabase/migrations/20261017225906_estimate_engine_v3_entry_paths.sql)
- [Source M6b](https://github.com/maxlemeur/HEX_BC/blob/5cfd4a94215975f3caa122ff5f64e1192b60cc5f/supabase/migrations/20261018013249_estimate_creation_set_based_item_effects.sql)
