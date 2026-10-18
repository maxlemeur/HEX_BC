# Application de la migration 2.6 au Supabase partagé — 18/10/2026

**Migration du sous-lot 2.6 appliquée et vérifiée, sans donnée applicative modifiée, sans politique de calcul et sans déploiement.**

Projet : `ijropnynpwjbllievrip`. Source immuable : `main` à `da462ac4622893c9d8287e4c56eaa9048eba20e5`, fusion de la PR #44 ; dernier commit du fichier `d0d82b4e`.

| Source exacte | Version distante générée | Méthode |
|---|---|---|
| `20261017205000_estimate_engine_v3_line_repricing.sql` | `20261018041924` | `apply_migration` (MCP `supabase_miaouffrage`) |

Le fichier exact de **2 258 octets** a été transmis sans modification. SHA-256 : `dfca54e8ba90f205d95208b9faf22717ea02649e90424572d1343f8ebc7b9db5`, égal à `supabase/migrations.manifest.json` sur `main` ; blob Git : `03cb91ff4457cdd97f6ac1a1aa521697f4e028e7`. Application le 18/10/2026 à 06:19:24, Europe/Paris. Aucun `supabase db push`.

Autorisation : le porteur a autorisé le 18/10/2026 vers 03:05, Europe/Paris, l'application des migrations du lot 2 (2.6, M5, M6 et M6b) après la fusion de leurs PR, selon ce protocole. Aucune politique de calcul ni aucun déploiement n'entre dans cette autorisation.

## Contenu

Une fonction de déclencheur et un déclencheur, sans DML ni modification de contrainte :

- `private.provision_estimate_item_v3_repriced_pu()` : quand une ligne non chiffrée redevient `priced` sans PU, pose un PU provisoire nul. La projection du même lot écrit ensuite le PU du moteur, puis `private.estimate_v3_assert_draft` vérifie ce PU dans la même transaction.
- `ac_provision_estimate_item_v3_repriced_pu`, `BEFORE UPDATE OF pricing_status` sur `public.estimate_items`.

Seules les lignes du moteur 3 peuvent quitter le statut `priced` (garde de colonnes de M4). Le déclencheur est donc sans effet sur les versions v1/v2.

## Préconditions en lecture seule

| Contrôle | Résultat |
|---|---|
| Fonction `private.provision_estimate_item_v3_repriced_pu` | absente |
| Déclencheur de réévaluation sur `estimate_items` | absent (0) |
| Colonne M4 `estimate_items.pricing_status` | présente ; type `estimate_line_pricing_status`, 6 valeurs |
| `private.estimate_v3_assert_draft(uuid)` (M4) | présente, une seule signature |
| `public.guard_estimate_item_engine_columns` (M4) | présente |
| Dernière migration distante | `20261017230116`, soit M7 |
| Versions moteur 3 | 0 |

Déclencheurs existants sur `estimate_items` avant application : `aaa_guard_transferred_purchase_item`, `aay_guard_estimate_item_engine_columns`, `aaz_guard_estimate_v2_snapshot_columns`, `ab_derive_estimate_item_v3_columns`, puis huit déclencheurs non préfixés. Le nouveau `ac_…` s'exécute après `ab_derive_estimate_item_v3_columns`, comme dans la chaîne canonique.

## Contrôles après application

| Contrôle | Résultat |
|---|---|
| Corps `prosrc` | 321 caractères, MD5 `e372ad1d131bd7673ad9efed0cd3ed04`, identique au texte entre `$$` du fichier |
| `proconfig` | `search_path=""` |
| SECURITY DEFINER | non (`SECURITY INVOKER`) |
| ACL | `{postgres=X/postgres}` ; `EXECUTE` refusé à `anon`, `authenticated` et `service_role` |
| Commentaire de fonction | présent |
| Déclencheur | `CREATE TRIGGER ac_provision_estimate_item_v3_repriced_pu BEFORE UPDATE OF pricing_status ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION private.provision_estimate_item_v3_repriced_pu()`, activé (`O`) |
| Historique | une seule nouvelle ligne, `20261018041924` / `20261017205000_estimate_engine_v3_line_repricing` |
| Versions moteur 3 | 0, comme avant |

## Empreintes des données

Méthode : MD5 par ligne sérialisée (`t::text`), concaténation ordonnée par `id`, puis MD5 de l'ensemble, avec contrôle séparé du nombre de lignes.

| Table | Lignes avant / après | Empreinte avant / après |
|---|---|---|
| `public.estimate_items` | 1 305 / 1 305 | `8c89597805e038a0d00dd590503c5451` / identique |
| `public.estimate_versions` | 1 238 / 1 238 | `5a7c2227934c663894fc72fa3ce2d7cc` / identique |

La migration ne contient aucun DML. Le déclencheur ne s'exécute que sur un `UPDATE` de `pricing_status`, et aucun n'a été émis. L'empreinte porte sur les deux tables du périmètre, pas sur l'ensemble des tables comme pour M7.

## Preuve comportementale

Le comportement est prouvé sur des piles locales, pas sur le partagé. Sur la tête `0dec560f` de la PR #44, la CI est verte : `rls-matrix` (chaîne `db:ci:local` complète, pgTAP et matrice RLS sur toutes les migrations), `army-critical` (dont V3E02, retour « Hors lot » → « Chiffrée »), `quality-gate`, `Tests`, `Statique` et `smoke`. Détail des parcours : [estimate-engine-v3-2.6.md](./estimate-engine-v3-2.6.md).

Aucune fonction métier n'a été appelée sur le partagé, et aucun devis v3 n'a été créé pour exercer le déclencheur.

## Écarts préservés et limites

- Le nom `estimate_items_pu_ht_check` reste différent du canonique `estimate_items_pu_ht_cents_check` (même prédicat). La migration 2.6 ne nomme aucune contrainte.
- Pas de relevé global des fonctions ni des tables hors du périmètre 2.6 : la migration ne crée qu'un objet et un déclencheur, sans `create or replace` d'objet existant.
- Conseillers Supabase non relus : l'outil n'est pas exposé dans cette session.

**Aucune autre migration, politique de calcul ou opération de déploiement n'a été exécutée.** Restent à appliquer après fusion de leurs PR : M5 (2.7, `20261017213500`), puis M6 et M6b (2.8). M8 (2.10) exige l'accord explicite du porteur.

- [Rapport structuré](./shared-supabase-2-6-2026-10-18.json)
- [Source immuable](https://github.com/maxlemeur/HEX_BC/blob/da462ac4622893c9d8287e4c56eaa9048eba20e5/supabase/migrations/20261017205000_estimate_engine_v3_line_repricing.sql)
