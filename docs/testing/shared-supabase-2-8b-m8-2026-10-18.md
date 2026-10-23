# Application de 2.8b et de M8 au Supabase partagé — 18/10/2026

> Reçu historique conservé pour le garde de migrations appliquées. Les identités et résultats ci-dessous décrivent cette exécution datée ; pour la procédure actuelle, voir [Supabase](../../supabase/README.md).


**Les deux migrations sont appliquées, dans l'ordre, et vérifiées. Aucun devis existant n'a changé de moteur ni de montant. Aucune politique de calcul n'a été posée et rien n'a été déployé.**

Projet : `ijropnynpwjbllievrip`. Source : `main` à `56de5b1d` (fusion de la PR #68, sous-lot 2.10b), qui contient la PR #59 (sous-lot 2.8b).

Autorisation : le porteur a autorisé l'application des migrations du lot 2 après la fusion de leur PR, et M8 au Supabase partagé (« go M8 », 18/10/2026 vers 18:20). L'outil `apply_migration` du MCP ayant été refusé deux fois par le système de permissions (20:44 et en session principale), le porteur a appliqué lui-même les deux migrations ; la session principale les a vérifiées en lecture seule.

| Migration | Fichier sur `main` | Octets | MD5 | SHA-256 (= manifeste) | Version distante |
|---|---|---|---|---|---|
| 2.8b, copies dans une v3 (PR #59) | `20261018180306_estimate_v3_batch_copy_effects.sql` | 56 622 | `2ded5aea8aa860453799e4ee4070b940` | `d8ad054a…f04028473b` | `20261018191755` |
| M8, moteur 3 par défaut (PR #68) | `20261018183629_estimate_engine_v3_default.sql` | 26 633 | `89dcc7fca75d8728978a635337818e17` | `0fdaba7c…11856de11a` | `20261018191853` |

## Vérification en lecture seule (après application)

- **Historique** : 308 lignes. Chaque migration y figure une seule fois, en une instruction dont le MD5 et la taille sont ceux du fichier. Les deux précédentes sont `20261018172935` (ordre du contrat 2, distante `20261018175846`) et `20261018170351` (reçus d'insertion complets, distante `20261018172141`).
- **Corps des fonctions = fichiers** (MD5 du texte entre délimiteurs) :

| Fonction | MD5 distant = fichier | Longueur | SECURITY DEFINER | search_path | Droits |
|---|---|---|---|---|---|
| `private.canonical_estimate_batch_operations(jsonb)` | `362d2974…` | 6 535 | non | `""` | postgres |
| `public.commit_estimate_batch(uuid,uuid,timestamptz,uuid,jsonb×6)` | `7bc2f6c5…` | 32 449 | oui | `""` | postgres, authenticated |
| `public.estimate_creation_replay_item_effects_for_writer(uuid,uuid[])` | `3c9a289f…` | 10 541 | oui | `""` | postgres, service_role |
| `public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)` | `7167bf9a…` | 23 473 | non | `""` | postgres, service_role |

  Pour les trois fonctions de 2.8b, les droits, `SECURITY DEFINER` et `search_path` sont ceux relevés juste avant l'application ; ni 2.8b ni M8 ne contiennent de `GRANT` ou de `REVOKE`, donc `CREATE OR REPLACE` a gardé ceux de `persist_estimate_creation_atomic`.
- **Données** : 1 238 versions (398 en moteur 1, 840 en moteur 2, **0 en moteur 3**) et 1 305 lignes, comme avant ; aucune version existante n'a été convertie. `tenant_calc_policies` et `tenant_calc_policy_events` sont vides : aucune politique n'a été posée.
- Contrôles déclarés par le porteur lors de l'application : SQL exact et fonctions vérifiés après chaque étape, 122 tables et 39 683 lignes inchangées, 1 982 assertions pgTAP et la matrice RLS réussies ; CI qualité, critique et smoke verte sur `main`.

## Conséquence

Aucune entreprise du Supabase partagé n'a de ligne de politique de calcul : **toute nouvelle estimation y est désormais créée en moteur 3** (coefficients 1,30 / 1,20, taux 20 / 10 / 5,5 / 2,1 %). Une politique 2 explicite par entreprise ramène au moteur 2. La duplication garde le moteur de la source.

## Limites

- Aucun déploiement Vercel : la version servie peut précéder le lot 2. Le déploiement reste manuel et sur demande du porteur (`AGENTS.md`).
- Écart connu, antérieur et inchangé : trois anciennes migrations du dépôt manquent par nom dans l'historique distant (`20260714120000`, `20260714134334`, `20260718014058` vide) ; aucune n'est un prérequis de 2.8b ou de M8.
- La copie de 1 000 lignes dans une v3 passe à 7,98 s du délai de 8 s en CI (IO13, PR #59) : marge mince, une écriture ensembliste est proposée en suite.
- Signalé par le porteur, hors de ce périmètre : le cron de récupération échoue pour une configuration manquante.
