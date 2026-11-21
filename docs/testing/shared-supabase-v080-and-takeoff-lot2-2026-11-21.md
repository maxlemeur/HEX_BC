# Migrations v0.8.0 et takeoff sur la base partagée — 21 novembre 2026

Une migration sur les sept autorisées a été appliquée. À 06:41:49 UTC, Supabase a enregistré TI-711 dans son intégralité. Le contrôle suivant attendait le fichier privé de son dernier saut de ligne. Supabase a conservé cet octet. Le lot s’est arrêté avant TI-709. [Données du reçu](./shared-supabase-v080-and-takeoff-lot2-2026-11-21.json)

## Historique

Avant l’application, la base comptait 408 lignes. L’empreinte des 407 premières, recalculée selon le [reçu du 15 novembre](./shared-supabase-intake-transcriptions-2026-11-15.md), était `8a37267e2f68e79acd5d4f1a3e6c5834d230ff71db9a12fbec90397c17d5debb`. La ligne 408 portait la version `20261115223706` et le SHA-256 publié. À 06:43:09 UTC, ces empreintes et les 408 couples version/nom étaient identiques. TI-711 était la seule ligne supplémentaire.

## Application de TI-711

La [migration des références fournisseur](../../supabase/migrations/20261117193734_workbook_supplier_references.sql), fusionnée par la [PR #369](https://github.com/maxlemeur/HEX_BC/pull/369) au commit `aed97d3bf`, a été lue sur `origin/main` à `dff50c2e1`. Le connecteur a reçu le fichier complet en un appel. Pour un fichier sans transaction explicite, Supabase documente l’annulation de l’ensemble en cas d’échec. [Documentation Supabase](https://supabase.com/docs/guides/integrations/supabase-for-platforms)

| Comparaison | Octets | SHA-256 |
| --- | ---: | --- |
| Fichier source, manifeste et SQL enregistré en une entrée, version distante `20261121064149` | 10 091 pour le SQL | `3d95a24e2400d5a44dc22dd2c42bc877d01079f81dab524760b454a2bf321f45` |
| Source et SQL enregistré, après retrait du dernier LF de chacun | 10 090 | `74c8b884d494c779ab0f4e46599c4cc96394c112e7bbd2804b137d62fc9e5bff` |

À 06:40 UTC, les 186 références existantes satisfaisaient la contrainte avec la nouvelle valeur par défaut. Il y avait zéro job takeoff, zéro incohérence et aucun objet prématurément présent parmi les 72 contrôlés. À 06:41:44 UTC, aucune autre session ne tenait ni n’attendait de verrou sur les relations contrôlées. Les contraintes, colonnes et fonctions nécessaires au chemin d’écriture de la v0.7.0 étaient présentes.

Après application, `reference_needs_review` est booléenne, obligatoire, avec `false` par défaut. La contrainte est validée et le déclencheur de protection est actif. Zéro référence est en attente de revue. Pour une future référence importée en attente, une écriture de prix est refusée. Une mise à jour qui conserve cet état ne peut activer la référence ou changer son SKU ou son URL. L’éditeur peut lever l’attente explicitement. Les quatre corps de fonction correspondent à la source, avec un `search_path` vide. Les empreintes et droits des trois rôles API figurent dans le JSON.

L’advisor de sécurité signale un nouveau WARN. La fonction d’import en `SECURITY DEFINER` est exécutable par `authenticated` et vérifie le tenant actif, le rôle et le droit d’édition. Cette catégorie passe de 81 à 82 constats. [Fiche de l’advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

## Suite du lot et avis de fin d’analyse

Les migrations des PR #370, #372, #371, #413, #415 et #425 restent en attente. Les préconditions individuelles et les effets en base de ces six migrations restent à vérifier. Aucun parcours d’écriture de l’application n’a été exécuté en production. La table d’activation est absente et aucun déploiement n’a eu lieu.

L’activation exige les trois migrations takeoff appliquées dans l’ordre avec la date non posée, l’application compatible en service chez l’hébergeur et sur le Mac autorisé, et zéro analyse ouverte renvoyée par la requête des relances sans demandeur connu. Cette requête dépend des migrations en attente. [Conditions de la PR #425](https://github.com/maxlemeur/HEX_BC/pull/425)
