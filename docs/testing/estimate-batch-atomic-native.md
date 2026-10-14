# Batch de chiffrage atomique — qualification native

Le scénario E2E WFC-01 a reproduit une annulation incomplète le 12 octobre 2026 :
après `committed:false`, C avait disparu mais B restait à 2 au lieu de 3 et le pied
à 7 au lieu de 5. L’archive est
`.e2e/army/coverage/runs/2026-10-12T03-01-23-175Z`, manifeste
`d1cb686a81ecbfe1fcd8eb4864ac7be0e410acc78b7813061d30b7e7937ea3e7`.
Le contexte fonctionnel reste dans [estimate-workflow-atomicity.md](estimate-workflow-atomicity.md).

## État des preuves

La fixture native initiale de 81 cas a été écrite et archivée **avant la migration
produit**. Trois cas de provenance héritée, deux cas de création suivie de
cascade et deux cas de déplacement hiérarchique ont été ajoutés avant leurs
correctifs, à la suite de revues concrètes. **88/88 assertions passent**, avec
rollback indépendant vérifié. La migration a ensuite été installée et vérifiée
sur la seule pile jetable 33485. Les cinq entrelacements natifs prioritaires
passent. Le pgTAP existant passe 13 fichiers/1234 assertions ; la réconciliation
de son lecteur historique est décrite ci-dessous, sans nouvelle exécution.

- Fixture initiale : `src/test/fixtures/estimate-batch-atomic-regression.sql`,
  SHA256 `3dc51d4422503fede1dedac908ab4de27c274ccfee97f0c4e825622a5493b2e8`.
- Original pré-code et plan :
  `.e2e/estimate-create-atomic/workflow-candidate/pre-code-01/` ; manifeste
  SHA256 `d1c74414d9c9be041b3dd4cb27f9d2756d9807c50df5249fe310cc661224cf3e`.
- Migration nouvelle créée par `supabase migration new atomic_estimate_batch`
  avec la CLI locale 2.120.0 :
  `supabase/migrations/20261012030743_atomic_estimate_batch.sql`.
  SHA installé `c9f02f6a2f769209a6908fc6b2481ccc622f44ac2a77a3a774b331b88ca250ec`.
- Fixture effectivement exécutée :
  SHA `545117427000cfcf1c6929704419349872fcfe3bb38d608fca2b4cee240936fd`.
- Exécution GREEN :
  `.e2e/estimate-create-atomic/batch-native/runs/2026-10-12T03-36-47-980092Z`.
  Manifeste SHA `56cf7a43abe16f981ede31907827c30628cf12aaf874e5e95391e18262157471`.
  `manifest.json` donne les 88 résultats, la commande exacte, les sources et
  les empreintes de chaque artefact ; `after-independent.json` provient d’une
  autre connexion. Wrapper exit 0 ; psql exit 3 attendu sur le `P9001` volontaire.

Les trois runs précédents restent archivés, sans réécriture :

| Run sous `batch-native/runs/` | Résultat observé | Correction |
| --- | --- | --- |
| `2026-10-12T03-19-01-596412Z` | Compilation refusée, avant fixture ; rollback vérifié | Parenthèses de l’expression CASE dans le canoniseur SQL. |
| `2026-10-12T03-19-52-429765Z` | Précondition fournisseur refusée, avant assertions ; rollback vérifié | Ajouter le catalogue fournisseur requis par la normalisation existante. |
| `2026-10-12T03-20-57-652496Z` | 80/84 ; rollback vérifié | Préparer les rôles sur le propriétaire réel, résoudre les noms privés comme observateur pour vérifier les ACL explicites, et fournir un token historique distinct dans le DO. |

Le dernier ajustement de token utilise un trigger TEMP activé uniquement pour
l’UUID du témoin et sa mutation tardive. `now()` restant constant dans un DO,
cette précondition permet de vérifier la restitution du reçu et de l’état
courant distinct. Elle **ne qualifie pas l’horloge de production ni deux vrais
commits** ; le témoin concurrent décrit ci-dessous fournit séparément deux vrais
commits puis le replay historique. Aucun trigger produit
n’est supprimé ou désactivé. Les attentes métier des assertions restent intactes.

La revue préalable a aussi corrigé la relecture du propriétaire après attente
du verrou. Le cas de provenance ajouté conserve `source_job_id` lors d’un
UPDATE hérité ; une création exige le job de la version cible ou un lien
`takeoff_version_links` explicite concordant et verrouillé. L’archive
`workflow-candidate/pre-provenance-fix/` conserve les assertions et le SQL
précédant ce correctif.

Le premier GREEN de 84 cas reste conservé dans
`runs/2026-10-12T03-22-54-204235Z`, candidat
`8d284b9e22c4744ea300468d2a979702b81f692a816cdff5d800d13b4a9fdf74` et fixture
`39a03ff6b03f5ea04f36be4744a8c544fc26c1be5ef650af2f336ea242829998`.
La revue suivante a identifié un batch valide : créer C sous une section
existante S, puis supprimer S. C ne figure alors plus dans la projection finale.
Deux assertions ont précédé le correctif et sont archivées dans
`workflow-candidate/pre-cascade-create-fix/` (manifeste
`dc0fc472c1f42dc5a3e1604a5717937916adb050c75f5349ed3fb9589e1e94fe`).
Les quatre montants provisoires peuvent valoir zéro pour cette seule création
absente de la projection ; le contrôle final de l’ensemble exact des lignes
continue de refuser une création survivante sans projection, sans aucun effet.
Les résultats create/update supprimés indiquent `item:null`,
`deleted_in_batch:true` et leur `deleted_item_id` original. Le test vérifie aussi
la fermeture S+A+B+C, le pied nul, l’absence de lignes finales et le reçu unique.
Le GREEN de 86 cas confirme ces attentes ; il n’efface pas la preuve précédente.
Il reste archivé dans `runs/2026-10-12T03-27-30-071507Z`, manifeste
`d433307dbcaa6f84cc62d22ebb5e28fb9a7cc8a9f9476206edf9c8f191622d49`.

La revue suivante a trouvé deux déplacements que la validation du seul nœud
déplacé ne suffisait pas à refuser : rattacher une section sous son descendant,
ou déplacer un sous-arbre dont les descendants dépassent la profondeur autorisée.
Les deux témoins ont précédé le correctif, archivés dans
`workflow-candidate/pre-hierarchy-fix/`, manifeste
`00dc37c919d7e584d69a6efde02c31e16536e5b2448e7a86e0e120f303bb584b`.
Le run `2026-10-12T03-34-35-512966Z` a produit **86/88**, avec ces deux refus
attendus absents et un rollback indépendant vérifié. La garde ciblée du batch
parcourt désormais la chaîne des parents et le sous-arbre, avec détection de
cycle et borne de profondeur, avant l’UPDATE. Les triggers globaux restent
inchangés. La relecture indépendante et le GREEN88 portent sur le SHA installé.

L’isolation native vise les appels RPC directs, les ACL du registre, les cascades,
les erreurs tardives d’audit/reçu et la monotonie des faits techniques. Un parcours
navigateur ne peut pas observer sûrement ces frontières. Les sommes figurent
comme valeurs attendues explicites ; aucune formule de prix n’est réimplémentée
dans cette fixture SQL.

## Contrat observable

Un batch est une transaction unique : opérations dans leur ordre, projection
financière canonique, pied, audit et reçu. Une faute confirmée annule cet ensemble.
Les opérations antérieures à l’erreur portent `data:{rolled_back:true}` ; elles
ne prétendent pas avoir conservé une ligne. Une issue transport inconnue ne peut
jamais être présentée comme une annulation confirmée.

La clé est obligatoire pour toute écriture. Le reçu est propre à l’acteur et à
la version, et immuable. Le replay POST exige les droits writer actuels sans
exiger l’ancien bail ni le statut draft ; GET exige l’accès en lecture actuel
et l’acteur d’origine. Le token du commit reste distinct du token courant.

Le plafond SQL et HTTP est de 1000 opérations ; le défaut HTTP reste 100. La
requête publique est bornée à 1 MiB et le reçu à 2 MiB. La projection comprend
toutes les lignes requises, même au-delà de 1000 lignes, sans troncature.
La politique AID brute est vérifiée sous le verrou de configuration ; le SQL
ne prétend pas exécuter le moteur d’expressions régulières JavaScript.

## Protocole de qualification avant installation

Le wrapper ignoré `.e2e/estimate-create-atomic/batch-native/native.py` dérive du
wrapper CORE-08 déjà relu. Il cible exclusivement la pile jetable propre au test :

| Identité | Valeur attendue |
| --- | --- |
| WSL | `Ubuntu-24.04` |
| Base | `127.0.0.1:33485/postgres` |
| API | `http://127.0.0.1:45585` |
| Identifiant système | `7695571534776503175` |
| Répertoire | `/home/tanuki/.local/share/miaouffrage-coverage-qa/run-729799711d9c404b` |
| Reçu transport | `.e2e/source-coverage/disposable-native/runs/729799711d9c404b/core08-qualified/stack.json` |
| SHA du reçu | `096f2f8a7e04bdf2753f238416f83054dfd3ef7bd76e2588bb2b3d47dfab077d` |

L’ancienne base 32959 est interdite. Le wrapper vérifie le reçu, les fichiers
copiés de la pile, l’identité native et l’absence de candidat/fixture. Il archive
ses sources, migration, fixture, requêtes de catalogue/droits et empreintes.
Les délais PostgreSQL sont fixés avant le DO : statement 90 s, verrou 2 s,
transaction inactive 10 s ; le processus est borné à 120 s.

Candidate et fixture s’exécutent dans un seul DO terminé par l’erreur volontaire
`P9001`. Chaque cas a son sous-bloc annulé. Une connexion indépendante vérifie
ensuite l’égalité du catalogue, des ACL et des données préexistantes. La portée
des empreintes de données est public/private, `auth.users` et les métadonnées
`storage.buckets/objects`, sans octets Storage ni autres tables Auth.

Après revue et coordination de la fenêtre, la dernière commande exécutée était :

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/native.py --execute --approval-reference root-batch-hierarchy-green-20261012 --migration-sha c9f02f6a2f769209a6908fc6b2481ccc622f44ac2a77a3a774b331b88ca250ec --fixture-sha 545117427000cfcf1c6929704419349872fcfe3bb38d608fca2b4cee240936fd
```

L’exit code de psql doit être distingué de celui du wrapper : le `P9001` final
est l’annulation requise, pas à lui seul un succès. Seuls les cas explicitement
PASS et la conservation indépendante peuvent produire `verified`.
Ce wrapper refuse maintenant la pile où le candidat est installé : il ne doit
pas être relancé pour réappliquer le DDL ni contre l’ancienne base 32959.

## Installation locale et réconciliation

Le helper relu `batch-native/install-local.py`, SHA
`ddb1a8e14c22a7b30eea31e585fa8e31d769ad786754da3226c5abc6b55e6ae6`,
a copié exclusivement la migration finale et utilisé `migration up --local`
dans le workdir épinglé. Le commit avait eu lieu lorsque la requête SELECT
d’observation des corps de fonctions a échoué : elle contenait une parenthèse
fermante en trop. **La migration n’a pas été réappliquée.**

Le reçu initial `batch-native/installation/receipt.json` reste en état
`requested/cli_requested`, SHA
`db5c3dbb6f49c09e316f6c3ac1406274c3dd40065078a3f2f04592480cdd9e15`.
Son code de sortie CLI n’avait pas été conservé avant l’échec de l’observateur ;
il reste `null`, sans reconstruire un faux exit 0. Un helper distinct de
réconciliation n’exécute que des lectures et la demande NOTIFY de rechargement
du schéma PostgREST, sur la même identité native.

Le reçu final est `batch-native/installation/reconciliation-01/receipt.json`,
SHA **`bb37d0db1196eba5c1b454ae1093b887b13ad175931c0d35872454e5ff920eda`**,
`status:verified`, `phase:commit_verified`, `reconciledExistingCommit:true` et
`migrationReapplied:false`. Il confirme la conservation des données préexistantes
du périmètre déclaré, des ACL, des objets de catalogue non concernés et de
l’historique antérieur. Les corps/ACL des sept fonctions concernées sont
vérifiés ; le registre nouvellement créé est vide et sans droit direct.
La seule fonction antérieure dont le corps change est la garde de contexte,
étendue à AID. NOTIFY est une demande de rechargement, pas une preuve HTTP.

Commandes conservées dans les reçus :

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/install-local.py --execute --approval-reference root-batch-owned-stack-install-c9f02-20261012
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/reconcile-installation.py --execute --approval-reference root-batch-existing-commit-read-reconcile-20261012
```

Le transport de continuation append-only est
`.e2e/source-coverage/disposable-native/runs/729799711d9c404b/batch-installed/stack.json`,
SHA `31ab19e4f4c611817bc9d3c5e26f1eb2bab21f0a99ff3f826dadc42659338dbb`.
Il conserve son prédécesseur `096f2f8…`, l’ancien pgTAP historique et déclare
explicitement `pgTapPassed:false` pour la nouvelle migration. Aucun reçu ancien
n’a été réécrit. `npm run supabase:manifest:add` puis `npm run supabase:validate`
ont réussi après cette installation ; aucune migration antérieure n’a été modifiée.

## Cinq entrelacements réellement exécutés

Le plan `batch-native/concurrency-plans/ab76ed44c27747f0/plan.json`, SHA
`3aa55044b60f610f0db1fa4ab1055b19853be1b333b19203304e243b639b9926`,
précède l’exécution. Les helpers ont reçu une revue indépendante avant ouverture
des sessions. Le résultat est **5/5**, sans échec ni réapplication :
`batch-native/concurrency-runs/ab76ed44c27747f0/manifest.json`, SHA
`131c33307cabdd1bfeabfed0c038a072fff2cc571f7a61bb095ddf6a56221440`.

| Entrelacement | Preuve observée |
| --- | --- |
| Même clé, même demande | B attend le PID exact de A, puis reçoit le même reçu et les mêmes identités sans seconde écriture. Un second commit indépendant change ensuite le titre ; GET et POST de la première intention gardent le reçu ancien et rendent le nouveau token courant. |
| Même clé, demande différente | B attend A puis reçoit `ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT`, sans ligne, audit ni reçu supplémentaire. |
| Deux clés, même CAS | B attend A puis reçoit `ESTIMATE_BATCH_STALE`, sans effet de la seconde clé. |
| Insertion de la règle AID après le batch ouvert | Le verrou advisory partagé de A est observé ; le writer reçoit le refus exact `ESTIMATE_CREATE_CONTEXT_CHANGED`. A commit seul. |
| Insertion AID avant le batch | Le verrou exclusif du writer est observé ; le batch reçoit `ESTIMATE_BATCH_CONTEXT_CHANGED`. Après commit de la règle, l’ancien contexte reste refusé et une capture fraîche permet le batch. |

Les trois premiers cas archivent `pg_blocking_pids(B)` avec le PID exact de A.
Les deux derniers prouvent le refus du try-lock avec les véritables verrous/PID,
sans présenter ce refus immédiat comme une attente. L’observateur ne voit aucun
état partiel avant commit. Les compteurs de reçus/audits, lignes, prix et pied
finaux sont vérifiés. Les empreintes SHA256 et leur multiplicité conservent
toutes les lignes préexistantes du périmètre, y compris les clés composées.
Catalogue, historique et droits restent identiques. Les nouveaux UUID et les
identités générées par les triggers sont conservés dans les inventaires ; aucune
purge n’a été exécutée.

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/concurrency.py --execute --plan-path /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/concurrency-plans/ab76ed44c27747f0/plan.json --plan-sha 3aa55044b60f610f0db1fa4ab1055b19853be1b333b19203304e243b639b9926 --approval-reference root-batch-five-races-owned-stack-20261012
```

## pgTAP et lecteur de résultat

La commande suivante a réellement exécuté les fichiers existants, sans reset,
copie de test, seed ni nettoyage :

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/pgtap.py --execute --approval-reference root-batch-pgtap-owned-stack-20261012
```

`batch-native/pgtap/pgtap-output.txt` rapporte `All tests successful`,
**13 fichiers / 1234 assertions**, `Result: PASS`, exit CLI 0. Les données et les
droits/catalogue sont identiques avant et après. Le premier wrapper a pourtant
produit un reçu `failed`, car il comparait au total historique fixe 1232. Ce reçu
est conservé, SHA `01df999a982aff2518fd0bf35b97caa9204e9587f7b75c507e33322924ca48e7`.

L’écart est expliqué par `security-invariants.test.sql:47–61` : ce test émet une
assertion `search_path` par fonction publique SECURITY DEFINER. Les deux ajouts
de catalogue sont exactement `commit_estimate_batch` et
`get_estimate_batch_receipt`. Les 13 sources de tests et les relations publiques
sont inchangées depuis le précédent pgTAP. Le lecteur corrigé compare désormais
la liste complète, unique et exacte des fichiers attendus, l’exit 0, le résultat
de `pg_prove` et la conservation ; le nombre d’assertions est seulement observé.

La sortie CLI agrégée ne conserve pas chaque ligne TAP. La complétude des plans
est validée par `pg_prove`; aucun appel explicite skip/TODO n’existe dans les
13 sources archivées et aucune marque de ce type n’apparaît dans la sortie.
Ce constat ne doit pas être transformé en compteur runtime individuel inventé.
La réconciliation est une lecture des artefacts vérifiés, sans nouveau run DB.
Elle a terminé avec `status:verified`, `databaseExecuted:false`, `rerun:false`
et `rollbackVerified:true` dans
`batch-native/pgtap/reconciliation-01/receipt.json`, SHA
`5db77bd988a7f46708842932e2e87185efc6541e7ebeb7e915d0bb870884d678`.
Les empreintes de tous les artefacts du run initial et du précédent pgTAP sont
vérifiées avant de comparer les catalogues. La revue indépendante a également
contrôlé le lecteur et cette chaîne de preuves.

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-create-atomic/batch-native/reconcile-pgtap.py --execute-offline
```

Le transport courant est désormais
`.e2e/source-coverage/disposable-native/runs/729799711d9c404b/batch-qualified/stack.json`,
SHA `4f9ecb5bfb8ad2d9cc60530b2b76e75f43e0924ee05b8ebb6534f454c348419c`,
avec `pgTapPassed:true`, le résultat observé 13/1234, le lien au transport installé
`31ab19e…` et les deux reçus pgTAP (run original et réconciliation). Les campagnes
UI antérieures conservent leur propre transport historique ; elles ne sont pas
réécrites pour adopter cette qualification ultérieure.

## Limites concurrentes restantes

Le plan complet contient d’autres entrelacements non exécutés dans cette tranche :
changement de rôle, palier ou flag de calcul ; retrait de droit ou de bail ;
changement de propriétaire pendant attente ; suppression parent face à l’écriture
d’une dépendance ; réponse réellement perdue après commit.
Chaque entrelacement doit établir les PID et soit la contention exacte, soit le
refus du try-lock observé. Un DO isolé ne prouve aucune de ces courses.

L’unité atomique est le batch. Un collage en plusieurs chunks garde une limite
distincte : les chunks précédents commis sont conservés et annoncés, sans DELETE
de compensation aveugle. La finalisation d’un ouvrage est hors de cette migration.

Les helpers et les archives sous `.e2e` sont ignorés par Git : la fixture et la
migration suivies restent disponibles depuis un checkout propre, mais la commande
complète du laboratoire exige aussi la conservation de ces helpers et reçus.
