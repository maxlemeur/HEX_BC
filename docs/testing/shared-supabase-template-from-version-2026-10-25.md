# Enregistrement de modèle depuis une version sur le Supabase partagé — 25/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).

**Migration présente et vérifiée : `create_estimate_template_from_version` remplacée, deux lectures ajoutées, toutes trois exécutables par `authenticated` et `service_role` seulement. Aucun déploiement dans ce reçu.**

Projet : `ijropnynpwjbllievrip` (`bon_de_commande`). Source : `main` à `9e009ce` (fusion de la [PR #105](https://github.com/maxlemeur/HEX_BC/pull/105)). Appliquée par le porteur, sous son autorisation des migrations fusionnées.

| Identité | Valeur |
|---|---|
| Migration canonique | `20261025094300_template_from_version_checked_once.sql` |
| Taille | **10 634 octets** |
| SHA-256 (fichier = manifeste = instruction enregistrée) | `d4694944c622df715786e4e5a56d17bdf0916cc72f6b08a0d131be96224eb563` |
| Version distante | **`20261025111353`** |
| Nom distant | `20261025094300_template_from_version_checked_once` |
| Application | 25/10/2026 à 11:13:53 UTC |

## Vérifications

Relues en lecture seule le 25/10 à 13:07 UTC.

- Historique : une seule ligne pour ce nom, entre `20261024142907_estimate_fo_provision` (version `20261024170214`, [reçu](./shared-supabase-main-d8715ed-2026-10-24.md)) et les trois migrations du lot 3.3 ([reçu](./shared-supabase-lot-3-3-2026-10-25.md), qui compte 324 lignes avant elles).
- Les trois fonctions sont SECURITY DEFINER, `search_path=""`, propriétaire `postgres`, commentées, avec l'ACL `{postgres=X,authenticated=X,service_role=X}` ; `anon` n'a pas EXECUTE. MD5 des corps égal à la source :

| Fonction | Volatilité | MD5 du corps |
|---|---|---|
| `create_estimate_template_from_version(uuid, text, text)` | VOLATILE | `bce44abcf62c04f5422b93cd74999695` |
| `read_estimate_template_items(uuid, uuid)` | STABLE | `927ff7c25bdd799be4117378c98fdfef` |
| `count_estimate_template_lines(uuid, uuid[])` | STABLE | `8b669996e7f34f71d81079823927caa5` |

- Conseillers de sécurité (après le lot 3.3) : aucune fonction SECURITY DEFINER exécutable par `anon` ; les deux lectures ajoutées figurent parmi les 69 constats « exécutable par authenticated », comme `read_estimate_version_items`, car elles restreignent elles-mêmes les lignes au locataire de l'appelant.

## Limites

Pas de préflight ni d'empreinte avant/après du catalogue : la migration a été appliquée hors de ce fil, et ce reçu décrit l'état constaté ensuite. Aucun appel des fonctions sur le partagé et aucun déploiement : la production est restée à `d8715ed` (déploiement du 24/10 à 17:07 UTC). Les preuves fonctionnelles restent celles de la PR #105. [Rapport JSON](./shared-supabase-template-from-version-2026-10-25.json).
