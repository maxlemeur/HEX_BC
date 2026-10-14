# CORE-08 — preuve native de création atomique

État au 12 octobre 2026 : **45/45 régressions SQL séquentielles**, **8/8 courses
entre connexions**, **une course supplémentaire reproduite rouge puis verte**,
et **13 fichiers pgTAP / 1 232 assertions PASS**. Deux nouvelles migrations ont
été installées uniquement dans la pile native locale jetable identifiée ci-dessous.
Cette preuve ne qualifie ni l’interface HTTP, ni les calculs TypeScript, ni les
compensations des opérations applicatives composées de plusieurs créations.

## Destination et conservation

| Élément | Valeur vérifiée |
| --- | --- |
| Distribution | `wsl -d Ubuntu-24.04` |
| Hôte / base | `127.0.0.1:33485`, `postgres` |
| API de cette pile | `http://127.0.0.1:45585` |
| Identifiant du cluster | `7695571534776503175` |
| Projet | `miaouffrage-coverage-729799711d9c404b` |
| Workdir | `/home/tanuki/.local/share/miaouffrage-coverage-qa/run-729799711d9c404b` |
| PostgreSQL observé | `17.11` |
| CLI observée | `2.120.0` |

L’ancienne pile `32959` / API `59827` est explicitement exclue. Aucun appel SQL
ou HTTP ne l’a ciblée. Le binaire CLI réutilisé se trouve sous son ancien répertoire
de dépendances, mais chaque commande porte le **nouveau `--workdir` explicite**.
Ce chemin de binaire ne désigne pas la destination de connexion.

Avant/après chaque campagne, les preuves comparent le catalogue, l’historique,
les fonctions et triggers, les propriétaires/ACL, les politiques RLS, les rôles
et leur héritage, ainsi que les empreintes des données du périmètre déclaré :
toutes les tables `public`/`private`, `auth.users`, `storage.buckets` et
`storage.objects`. Pour les courses, le contrôle par IDs et empreintes est limité
aux tables de ce périmètre possédant une colonne `id` ; il ne couvre pas les
éventuelles tables sans cette colonne. Les contrôles séquentiels, installations
et pgTAP comparent l’ensemble du périmètre par empreintes agrégées. Les courses
ajoutent des fixtures synthétiques identifiées dans chaque `plan.json` et ne les
purgent pas. Les autres tables internes Auth,
les compteurs de séquences et les octets Storage ne sont pas présentés comme
couverts par cette conservation des données.

## Sources et contrat testé

| Source suivie | SHA-256 |
| --- | --- |
| `supabase/migrations/20261012020700_atomic_create_estimate_item.sql` | `12af939473dab9be200e37e191e91b19a0a220610ba8c743da2f9e0271071b31` |
| `supabase/migrations/20261012023009_guard_normalized_estimate_calculation_tenant.sql` | `20c7fd7c31788eab0ab607774f3449618f1ff72afe3ad534d9d47039f7bc73a9` |
| `src/test/fixtures/estimate-create-atomic-regression.sql` | `bdc90ddd0c297e4d6315db8678b34076894e13c4be2d7ee306a65439e0bc2e5a` |

`atomic_create_estimate_item(uuid,jsonb,jsonb,jsonb,timestamptz,uuid,jsonb)` reste
`SECURITY INVOKER`, avec exécution réservée à `authenticated`. Elle revalide le
tenant actif, le rôle réel, l’accès au projet, le brouillon, la session exacte du
verrou et le token attendu ; elle insère puis appelle le bulk canonique dans la
même transaction. V2 exige les quatre montants de toutes les lignes ; V1 impose
une projection de lignes vide et préserve les anciennes lignes. Les sections et
les brouillons comportant des heures sans rôle restent acceptés.

Le contexte RAW contient les rôles effectivement référencés, les paliers réels
(`[]` si absents) et le flag atelier/chantier (`null` si absent). Les defaults
financiers restent dans le calcul TypeScript. Aucun calcul financier n’a été
dupliqué en SQL et aucun snapshot de publication n’est créé par cette RPC.

Les verrous advisory partagés/exclusifs coordonnent les créations avec les
écritures de configuration, les memberships et l’activité des tenants. Les
try-locks refusent un conflit sans créer un cycle d’attente. Le seul trigger
`SECURITY DEFINER` supplémentaire lit les membres concernés par une activation,
désactivation ou suppression de tenant ; il est privé, sans droit d’appel pour
les rôles applicatifs, et ne modifie aucune donnée ni aucun droit.

## Régression préalable et rollback

La première fixture de 39 cas a été archivée **avant le code de migration** dans
`.e2e/estimate-create-atomic/pre-code/estimate-create-atomic-regression.sql`, SHA
`165d45425a20f533abca37b51fe8a11d8af80040e56f89fdb4b3ca8a9cc5d6e4`.
Les six cas de droits supplémentaires ont été archivés avant le patch de
coordination des droits dans `pre-code/rights-regression-before-patch.sql`, SHA
`d9183aa5d4ee6331b1849f46916cc4cc6d9d93f4198b107c89985830bee0d2e9`.

Les 45 cas couvrent : V1/V2, sections, ligne incomplète, coercition des typmods,
provenance, admin, ACL, viewer/director/autre propriétaire/tenant inactif,
session absente/différente/expirée/perdue, token périmé, parent/version incorrects,
parent ligne, position dupliquée, overflow, rôles étrangers, injection de tenant
ou snapshot, projection manquante/dupliquée/étrangère/élargie, refus de réécriture
V1, échec tardif de ligne ou d’entête, modifications de flag/palier/tarif,
contexte superflu, non-brouillon, révocation/suppression de membership,
désactivation/changement de tenant actif et archivage du projet.

La précision observée inclut `1.0005 → 1.001`, `1.00005 → 1.0001` pour la
majoration, `999999999.9994 → 999999999.999`, et le refus d’overflow de
`999999999.9995` sans effet partiel. Les montants de la fixture sont des entrées
contrôlées : ce test démontre la transaction et les frontières SQL, pas la formule
de calcul du serveur.

Le candidat et la fixture ont été exécutés dans un **DO unique terminé par une
exception P9001 obligatoire**. Une connexion indépendante a ensuite vérifié le
retour exact à l’état initial. L’exit code `psql=3` est attendu pour ce rollback ;
le wrapper retourne `0` seulement si les assertions et la conservation passent.

| Archive sous `.e2e/estimate-create-atomic/runs/` | Résultat |
| --- | --- |
| `2026-10-12T02-17-55-145775Z` | 10 PASS ; refus de précondition fixture : segment numérique du nom GUC, rôle de préparation du statut. Rollback vérifié. |
| `2026-10-12T02-18-49-088738Z` | 44 PASS ; préparation `draft → archived` invalide. Rollback vérifié. |
| `2026-10-12T02-19-42-785601Z` | **45/45 PASS**, rollback indépendant vérifié. |

Les corrections de précondition conservent les assertions métier. Le cas
non-brouillon prépare un V1 `sent` avec le rôle serveur et un seal conforme au
trigger ; il ne prétend pas qualifier l’envoi d’un email. Les deux échecs et leurs
sources exactes restent archivés.

## Installation et correction de la course NEW tenant

`installation/receipt.json` : première installation CLI locale vérifiée, SHA du
reçu `d8c37788f25e319f3ac2589b6fc86c3ff4f71d66370eba00586817938ab53071`.
Les quatre fonctions et cinq triggers attendus ont été ajoutés ; les corps,
grants, propriétaires et historique ont été contrôlés indépendamment. Aucune
donnée existante n’a changé.

Une revue indépendante a identifié l’ordre des triggers sur `labor_roles` : la
garde s’exécutait avant `assign_tenant_id`. Une mise à jour `tenant_id=NULL`
verrouillait OLD mais ignorait le tenant NEW implicitement affecté ensuite.
La course réelle **V1 tenant B, ancienne ligne liée à un rôle A, acteur membre et
propriétaire A+B** a confirmé le défaut : le rôle a pu entrer dans B pendant une
création calculée avec `labor_roles=[]` sous le verrou B.

- RED conservé : `normalized-tenant-red/432a228b4c3b47a1/manifest.json`.
- Correctif append-only : la seconde migration prend
  `coalesce(new.tenant_id, public.current_tenant_id())` **uniquement pour
  `labor_roles`**, conformément au normalizer existant. La première migration
  installée n’a pas été réécrite. `margin_tiers` et `feature_flags` n’ont pas ce
  normalizer.
- `correction-installation/receipt.json`, SHA
  `688fe1cf7063506bdce4ca3be419dab4f00bd6ca876cd07d99ce4f555b89e152` : seule
  modification attendue du corps de garde, propriétaire/ACL/mode invoker et
  données conservés, nouvelle ligne d’historique vérifiée.
- GREEN de la même course, nouveaux UUID :
  `normalized-tenant-red/c3bafd9488564c8f/manifest.json`. Le déplacement concurrent
  est refusé avec `ESTIMATE_CREATE_CONTEXT_CHANGED`. Deux PID et les advisory
  locks détenus sont conservés avec l’état final.

## Huit entrelacements exécutés

Archive : `.e2e/estimate-create-atomic/concurrency/c2fc11083a9647cc/manifest.json`,
SHA `09363937d4ddf9b1cdff3164abdb21d155d40ef0d190e95814fe7536acb7f269`.
Chaque cas utilise deux connexions réelles et un observateur distinct, puis
contrôle les lignes, l’entête, le rôle, la configuration et le lease persistés.

| Cas | Résultat observé |
| --- | --- |
| `double-create` | Même token : une création commitée, seconde refusée STALE, aucune seconde ligne. |
| `rate-after-create` | L’UPDATE du rôle attend le FOR SHARE pris par le trigger V2 ; `pg_blocking_pids(B)` contient exactement A. Mise à jour autorisée seulement après commit A. |
| `tier-phantom` | INSERT d’un palier pendant la création refusé par le gate tenant ; aucun palier parasite. |
| `flag-phantom` | INSERT du flag auparavant absent refusé ; l’absence reste conservée. |
| `rate-before-create` | Écrivain tarifaire d’abord : création refusée ; ancien contexte encore refusé après commit ; contexte neuf accepté. |
| `membership-revocation` | Révocation pendant la création refusée ; révocation après commit autorisée ; création ultérieure interdite. |
| `tenant-deactivation` | Désactivation d’abord : création concurrente refusée ; après commit, acteur interdit sur cette version ; aucun item créé. |
| `lease-takeover` | Takeover attend le lease détenu par A, blocage exact observé ; après commit, nouvelle session établie et ancienne session refusée. |

Le premier run `concurrency/5adcae6c77d24266` a un seul cas PASS et un échec du
harnais : il exigeait à tort un conflit tarifaire immédiat alors que le verrou
de ligne V2 sérialisait correctement les écritures. Ce run est conservé. Le
second prouve le véritable blocage avant de l’accepter comme résultat.

Les variantes plus larges du plan — toutes les permutations DELETE de
configuration, tous les changements OLD/NEW et les phantoms membership pendant
activation d’un autre tenant — ne sont **pas** déclarées exécutées. Les huit cas
ci-dessus et la course supplémentaire NULL sont la portée exacte de la preuve.

## pgTAP et reçu final

`pgtap/receipt.json`, SHA
`6bb3bbd6c8bb2f8ab440a8de12e50c50ccd6dc5fe9488bcd4ffffb9d69f122f4` :
**13 fichiers, 1 232 assertions PASS**, sans reset, redémarrage, synchronisation de
tests ou purge. L’inventaire des tests copiés a été vérifié ; les états complets
avant/après sont identiques dans le périmètre de conservation déclaré.

Le transport final immuable est
`.e2e/source-coverage/disposable-native/runs/729799711d9c404b/core08-qualified/stack.json`,
SHA `096f2f8a7e04bdf2753f238416f83054dfd3ef7bd76e2588bb2b3d47dfab077d`.
Il décrit les deux migrations installées et le pgTAP courant. Les reçus précédents
restent intacts ; un ancien reçu ne doit pas être utilisé en supprimant son
contrôle d’inventaire pour le faire correspondre au nouvel état.

## Commandes et répétabilité

Exécutions historiques depuis la racine Windows ; chemins Linux résolus sur le
même checkout. Les commandes exactes, paramètres, sources, SHA, états attendus
et obtenus sont également dans les manifestes des runs.

```text
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/native.py --execute --approval-reference root-core08-disposable-rollback-20261012 --migration-sha 12af939473dab9be200e37e191e91b19a0a220610ba8c743da2f9e0271071b31 --fixture-sha bdc90ddd0c297e4d6315db8678b34076894e13c4be2d7ee306a65439e0bc2e5a
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/install-local.py --execute --approval-reference root-core08-owned-disposable-install-20261012
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/reproduce-normalized-tenant.py --execute
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/install-correction.py --execute
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/reproduce-normalized-tenant.py --execute --expect-blocked --stack /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/source-coverage/disposable-native/runs/729799711d9c404b/core08-corrected/stack.json --stack-sha ff15bd97582ca436c06ed2c45c50e6558cea6d54e1f4dd674217e5e5ef5807c4
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/concurrency.py --execute --approval-reference root-core08-eight-owned-native-races-20261012
wsl -d Ubuntu-24.04 python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/pgtap.py --execute
```

Les wrappers d’installation appellent exclusivement `supabase --workdir
<nouveau-workdir> migration up --local`. Le wrapper pgTAP appelle `supabase
--workdir <nouveau-workdir> test db --local <nouveau-workdir>/supabase/tests/database`.
Ils n’utilisent ni `--linked`, ni une URL arbitraire, ni une commande de reset.
Les appels WSL ont nécessité la sortie du sandbox Windows après un
`Wsl/E_ACCESSDENIED` survenu avant toute connexion ; les destinations sont restées
identiques et bornées.

Les scripts, inventaires, reçus, profils de runtime et résultats sous `.e2e` sont
**ignorés par Git**. Les sources utilisées sont copiées/hashées dans les archives,
mais un checkout propre ne contient pas ces dépendances : la répétabilité ici
est celle du poste et de ses artefacts conservés, pas une promesse de commande
autonome en CI. Les fixtures et migrations SQL, elles, sont suivies. Les wrappers
d’installation sont volontairement à usage unique et refusent une réapplication
aveugle. Le test natif pré-installation exige l’absence de la RPC ; après
installation, il faut préparer une nouvelle pile fidèle ou un parcours explicite
sur schéma installé, sans supprimer ces gardes. Aucun secret, token de session ou
octet de document n’est inclus dans les preuves décrites.

Documentation consultée avant SQL : [fonctions Supabase](https://supabase.com/docs/guides/database/functions),
[changelog Supabase](https://supabase.com/changelog),
[verrouillage PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS),
skills Supabase et Postgres, migrations et inspection native locale
`.e2e/estimate-create-atomic/native-before-schema.json`
(SHA `4b37992890974cb09e1d946be42d1ac65cd3befd3c68a74f9eff7170dfac3496`).
