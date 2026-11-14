# Rattrapage de `main` sur la base partagée — reçu du 13 novembre 2026

Le 13 novembre 2026, entre 19:52 et 21:10 UTC, sept migrations de `main` ont été appliquées sur la base Supabase
partagée, qui sert aussi la production. Elles l'ont été dans l'ordre de leurs dépendances, chacune après la fusion de
sa PR, avec le go explicite du propriétaire (« personne n'utilise la prod »). Aucune donnée métier n'a été écrite par
ces opérations ou leurs contrôles, et aucun déploiement n'a été fait.

## Source et méthode

| Fichier | PR fusionnée | Version distante | Octets fichier = SQL enregistré | Instructions enregistrées |
| --- | --- | --- | ---: | ---: |
| [20261113190113_material_request_order_confirmation.sql](../../supabase/migrations/20261113190113_material_request_order_confirmation.sql) | [#311](https://github.com/maxlemeur/HEX_BC/pull/311) (`f525aae5`) | `20261113195244` | 44 104 | 1 |
| [20261112234606_editable_ouvrage_quantity.sql](../../supabase/migrations/20261112234606_editable_ouvrage_quantity.sql) | [#299](https://github.com/maxlemeur/HEX_BC/pull/299) (`e7cb52cc`) | `20261113195629` | 14 952 | 1 |
| [20261113100956_intake_document_content_identity.sql](../../supabase/migrations/20261113100956_intake_document_content_identity.sql) | [#294](https://github.com/maxlemeur/HEX_BC/pull/294) (`ac1304cc`) | `20261113195640` | 1 208 | 1 |
| [20261112230829_takeoff_dpgf_accumulation.sql](../../supabase/migrations/20261112230829_takeoff_dpgf_accumulation.sql) | [#288](https://github.com/maxlemeur/HEX_BC/pull/288) (`8af529a0`) | `20261113200039` | 46 899 | 1 |
| [20261113175750_takeoff_dpgf_merge_refusals.sql](../../supabase/migrations/20261113175750_takeoff_dpgf_merge_refusals.sql) | [#314](https://github.com/maxlemeur/HEX_BC/pull/314) (`4915259f`) | `20261113200236` | 36 689 | 1 |
| [20261113195311_drop_broad_devis_storage_policies.sql](../../supabase/migrations/20261113195311_drop_broad_devis_storage_policies.sql) | [#318](https://github.com/maxlemeur/HEX_BC/pull/318) (`b5ae28c0`) | `20261113210922` | 1 072 | 1 |
| [20261113202356_takeoff_dpgf_merge_any_line.sql](../../supabase/migrations/20261113202356_takeoff_dpgf_merge_any_line.sql) | [#319](https://github.com/maxlemeur/HEX_BC/pull/319) (`8dd6bb71`) | `20261113211032` | 24 313 | 1 |

Pour chaque fichier, trois SHA-256 sont égaux : celui du fichier de `origin/main`, celui du
[manifeste](../../supabase/migrations.manifest.json) et celui du SQL enregistré
(`sha256(array_to_string(statements, E'\n'))`).

| Fichier | SHA-256 |
| --- | --- |
| `20261113190113_material_request_order_confirmation` | `289b3582ee386fd8d98448b90004543c99258e93013c81a7f97b302cbd0c71b4` |
| `20261112234606_editable_ouvrage_quantity` | `2853867cd610b354a0f0050ae811c68937fb83593f16616936f6d1704bddb93f` |
| `20261113100956_intake_document_content_identity` | `14cfe72bffce427f07cf743ead163dc06e19be12953507d721eec73c0e868aa3` |
| `20261112230829_takeoff_dpgf_accumulation` | `9e71d8e089e0af0aec8b817965ef284c94f67a80950d7353a70180fb04975002` |
| `20261113175750_takeoff_dpgf_merge_refusals` | `9a57d59f536ad87dcc53fd1d5f832d301a1c0c8a8923b36a0c95b30e6bf068c0` |
| `20261113195311_drop_broad_devis_storage_policies` | `e5c3973dc8b3d5cc7f75dd04260fc1199046aef0f1480cec060384b65599d734` |
| `20261113202356_takeoff_dpgf_merge_any_line` | `57a7d05ebffa6ba83165619d5728c754a87b4c44e8c956f6a20de9dda9eb7c76` |

Chaque fichier a été appliqué par un seul appel MCP `apply_migration`. L'appel porte le nom du fichier sans extension
et son contenu exact : UTF-8, fins de ligne LF, dernière fin de ligne incluse. La version distante correspond à l'heure
d'application. Aucun `db push` ni aucun SQL correctif n'a été exécuté. Les contrôles `execute_sql` étaient en lecture
seule.

## Ordre et dépendances

- **TI-682 D4, puis TI-716, puis TI-723 :** `20261112230829` (D4) crée `private.takeoff_compose_dpgf_targets`.
  `20261113175750` (TI-716) la redéfinit, puis `20261113202356` (TI-723) redéfinit la fonction d'application à cinq
  arguments que TI-716 venait de redéfinir. Les trois ont été appliquées dans cet ordre.
- **Les migrations « hypothesis » :** `20261111035718_takeoff_hypothesis_preselection` et
  `20261111124022_takeoff_hypothesis_provision_marker` figuraient déjà dans l'historique, sous leurs noms courts
  `takeoff_hypothesis_preselection` et `takeoff_hypothesis_provision_marker`. Elles n'ont pas été rejouées.
- **Les politiques de stockage :** `20261113195311` ne change rien sur cette base. Les quatre politiques larges
  `devis_*` y avaient été supprimées directement à 19:36:16 UTC, comme le consigne la
  [remédiation](../security-remediation-91386191.md). Après l'enregistrement, `storage.objects` ne porte sur le bucket
  `devis` que les trois politiques durcies (`Authorized users can view/upload/delete purchase order devis`) et aucune
  des quatre `devis_*`.

## Intégrité de l'historique

Après les applications, les **395 lignes** antérieures à la première (version < `20261113195244`) ont pour SHA-256
`66b78c69ec55de43f30c3208692b0171889b755a83e63516f13a6d50b6d0ef20`. Cette empreinte n'a pas été relevée avant la
première application : le reçu ne prouve donc pas que ces lignes sont restées identiques, seulement que sept lignes
s'y sont ajoutées. Aucune opération de ce rattrapage n'écrit dans l'historique autrement qu'en ajoutant sa ligne.

L'historique final compte **402 lignes**, SHA-256
`869079662f91023505ad741db0055697a1c9187c72c3386aa0b2dc07ecc9fbff`. L'empreinte est calculée en UTF-8 par
`sha256(string_agg(version||name||array_to_string(statements,E'\n'), E'\n' order by version))`.

Après les applications, chaque fichier de `supabase/migrations/` daté du 3 novembre ou plus tard est dans l'historique
sous son nom de fichier, à l'exception des deux migrations « hypothesis » citées plus haut.

## Advisor de sécurité

Après les applications, aucune catégorie nouvelle n'apparaît : `rls_enabled_no_policy` (INFO, 26),
`authenticated_security_definer_function_executable` (WARN, 79) et `auth_leaked_password_protection` (WARN, 1).

Parmi les fonctions `SECURITY DEFINER` exécutables par `authenticated` figurent `confirm_material_request_purchase_order`
et `receive_material_request_purchase_order`. Ce sont des RPC appelées par l'application : comme les autres, elles
vérifient elles-mêmes le tenant actif et le rôle.

## Déploiement et surveillance

Le propriétaire a donné son go le 13 novembre 2026 pour déployer `main` sans attendre les campagnes Full et calc-v3 :
« personne n'utilise la prod ». Deux déploiements ont suivi ces migrations, chacun après l'application de celles
qu'il lit.

| Déploiement | SHA | READY (UTC) | Contenu |
| --- | --- | --- | --- |
| `dpl_5XpXMBe18SDM9tSFk1e8q3KaKofU` | `f525aae5b16cbcc9174ca052064ed7ec7d5b2a2c` | 20:57:33 | jusqu'à #311 (TI-691 3b) |
| `dpl_5BWgG69FzdffvjjyJJtrBRK6jG3h` | `6f87d328b5c522ecb996045f0b0ffc3c269b0a2e` | 21:25:39 | jusqu'à #323, dont #318 et #319 (TI-723) |

Ce qui vaut pour les deux :

- **Source :** chacun est construit depuis la source Git exacte (`maxlemeur/HEX_BC`, ref égale au SHA), sans envoi de
  fichiers locaux. Sa ligne de clonage cite le SHA.
- **Alias :** `https://hex-bc.vercel.app` pointait sur lui au début et à la fin de sa surveillance. Il pointe sur
  `6f87d328` depuis 21:25 UTC (contrôle à 21:31:27).
- **Surveillance :** 5 minutes chacun, 11 passages espacés de 30 secondes, **22 requêtes réussies sur 22**. À chaque
  passage, `/api/health` a répondu HTTP 200 avec `ok: true` et `db: up`, et `/login` HTTP 200 avec son formulaire.
  - `f525aae5` : de 20:58:23 à 21:03:23 ; latence maximale 0,747 s (santé) et 0,375 s (connexion).
  - `6f87d328` : de 21:26:14 à 21:31:14 ; latence maximale 1,296 s (santé) et 0,404 s (connexion).
- **Logs :** aucun log runtime `error` ou `fatal` pour chacun, de sa création à la fin de sa surveillance.
- **Rien d'autre :** aucune variable modifiée, aucune écriture métier, aucune migration exécutée pendant ces
  déploiements, aucun retour arrière. Les déploiements précédents (`dpl_zzL2tddZ9T97Y5CoVoLv1saCs8Kq` pour
  `2d6e9b3f`, puis `dpl_5XpXMBe18SDM9tSFk1e8q3KaKofU`) restent disponibles.

### Contrôles du SHA servi

Sur `6f87d328`, Quality Gate, le smoke anonyme, TesterArmy Critical et calc-v3 sont verts. Le Full a été annulé par le
push suivant sur `main`. `npm run check:release` n'a pas été lancé : le propriétaire a demandé un déploiement direct.
Les six contrôles requis de chaque PR intégrée étaient verts à sa fusion.

### Hors de ce déploiement

`main` a avancé depuis le SHA servi : [#324](https://github.com/maxlemeur/HEX_BC/pull/324), la documentation de ce
reçu, et [#322](https://github.com/maxlemeur/HEX_BC/pull/322) (TI-701, filtres de la revue ciblée), qui n'est pas en
production.

## Limites

Les sondes sont anonymes. Elles prouvent la disponibilité HTTP pendant ces fenêtres et l'accès à la base, pas un
parcours métier : la confirmation et la réception des bons de commande (TI-691 3b) restent à recetter en production. Ce
sont des échantillons de cinq minutes : ils ne prédisent pas la disponibilité à venir.
