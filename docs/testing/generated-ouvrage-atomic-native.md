# Ouvrages : preuve transactionnelle locale

La migration candidate `20261012043643_atomic_generated_ouvrages.sql` regroupe
la revue humaine, l'application, le rejet et la clôture de génération sous les
mêmes contrôles de version, d'acteur, de tenant et de bail. Le calcul de vente
reste celui de l'application ; la transaction vérifie la représentation des
coûts/heures et publie ensemble les lignes, la projection financière, les
assemblages, les sources, les statuts et le reçu.

Les défaillances et parcours sont définis dans
[le contrat de récupération](generated-ouvrage-commit-recovery.md). La fixture
`src/test/fixtures/estimate-generated-atomic-regression.sql` a été écrite puis
étendue avant les corrections correspondantes. Les contrôles natifs ciblent
les fautes internes et frontières de droits que les seuls gestes navigateur
ne permettent pas de reproduire précisément.

## Qualification séquentielle avec rollback

Run : `.e2e/estimate-generated-atomic/native/runs/2026-10-12T05-10-07-655235Z`.
**100 cas réussis**, exception terminale volontaire `P9001`, sortie psql 3
attendue et sortie du wrapper 0. Le lecteur exige des identités de cas uniques,
aucune erreur, tous les verdicts positifs et la conservation indépendante.
Chaque faute tardive doit avoir avancé exactement une fois son compteur
temporaire ; un refus plus précoce ne suffit pas.

| Entrée ou preuve | SHA-256 |
| --- | --- |
| Migration candidate | `a75634075eaf645de95f1ae8ff3bb2574f3ea18ed97ea30f580c498b49e2c3e5` |
| Fixture exécutée | `f699d533a71f8ad2fb12597c175a7a7c29ceaa113616e4be29accb5d569f262f` |
| Manifeste terminal | `845d4cc8a1d313c5b0725b960a718ef5f287d24ed49d02ef40271069bb6406c8` |

Le parent a relu les 12 empreintes des artefacts et comparé les deux snapshots
indépendants. Données, catalogue et privilèges sont identiques avant/après.
La cible est exclusivement la pile jetable PostgreSQL `127.0.0.1:33485/postgres`,
système `7695571534776503175`, API `45585`. La pile `32959` et les bases distantes
ne sont pas concernées.

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-generated-atomic/native/native.py --execute --approval-reference root-generated-candidate-rollback-reviewed-20261012 --migration-sha a75634075eaf645de95f1ae8ff3bb2574f3ea18ed97ea30f580c498b49e2c3e5 --fixture-sha f699d533a71f8ad2fb12597c175a7a7c29ceaa113616e4be29accb5d569f262f
```

Les deux tentatives précédentes restent conservées : `05-00-48-660747Z` échoue
avant les cas sur une expression CASE, puis `05-04-53-690575Z` expose des noms
PL/pgSQL ambigus. Toutes deux vérifient le rollback ; aucune n'est une réussite
fonctionnelle. Le harnais a été durci pour ne pas compter une erreur SQL
structurelle comme un refus métier.

Cette preuve est séquentielle : elle ne démontre ni les courses réelles, ni le
pgTAP du schéma installé, ni l'interface compilée. Cette exécution n'installe
rien de manière persistante. Les helpers et reçus sous `.e2e`
sont ignorés par Git et doivent être conservés avec l'archive pour reproduire
ce protocole ; ils ne sont pas fournis par une simple copie du dépôt.

## Installation distincte et pgTAP

La migration a ensuite été appliquée **une seule fois sur cette pile jetable**,
CLI 0, après revue des helpers et de la preuve précédente. Le reçu
`native/product-installation/receipt.json` porte `verified/commit_verified`.
Les 14 artefacts ont été relus : anciennes données, objets et droits conservés,
corps/ACL des fonctions vérifiés, nouvelle table de reçus privée et vide,
historique augmenté de la seule migration candidate. L'ancienne preuve de faute
WFC02 sous `native/installation/` reste inchangée.

| Preuve | SHA-256 |
| --- | --- |
| Reçu d'installation | `9710b69ba2e684a0f9ac387785423933f693267afedbe5cdc068cc86b2c79df8` |
| Transport `generated-installed/stack.json` | `b3e3fb122b6f1ba52e79f02e17294400f29dd2af6e9d94473b663f726c985800` |
| Reçu `native/product-pgtap/receipt.json` | `5536d98e73604a4ccf2cc4648b49866377ff72acc298335ec2b50503708dcb88` |
| Transport `generated-qualified/stack.json` | `b3fe9ea1e286c5b8276b50f1e800a8039178633346334a660c26c8ff4fe9d60a` |

Les transports se trouvent sous
`.e2e/source-coverage/disposable-native/runs/729799711d9c404b/` et les reçus
sous `.e2e/estimate-generated-atomic/`. Le transport installé conserve
`pgTapPassed:false` ; seul le transport suivant porte la qualification actuelle.

La suite existante pgTAP passe **13 fichiers / 1 241 assertions**, CLI 0,
`All tests successful` et `Result: PASS`. Les 26 empreintes et les snapshots
avant/après identiques ont été vérifiés indépendamment. Les plans et la liste
exacte des fichiers sont contrôlés ; le nombre d'assertions est observé. La
sortie ne conserve pas chaque ligne TAP : aucun compteur runtime de skips/TODO
n'est inventé. Aucun reset ni réparation des données n'a été effectué.

```text
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-generated-atomic/native/install-local.py --execute --approval-reference root-generated-owned-disposable-install-20261012
wsl -d Ubuntu-24.04 -- python3 /mnt/c/Users/maxim/Projects/miaouffrage/.e2e/estimate-generated-atomic/native/pgtap.py --execute --approval-reference root-generated-owned-disposable-pgtap-20261012 --installation-receipt-sha 9710b69ba2e684a0f9ac387785423933f693267afedbe5cdc068cc86b2c79df8
```

Ces helpers refusent une seconde exécution dans leur répertoire déjà utilisé.
Le `NOTIFY` de rechargement de schéma ne prouve pas la disponibilité HTTP.
Les courses réelles et les campagnes navigateur restent des preuves séparées.

## Onze courses réelles

Le protocole `native/concurrency-plan.md` précède le harnais. Le plan exact
`native/concurrency-plans/073d8e22e00a487e/plan.json`, SHA
`3900abe31f4a3a6720f6a8362b0571a237ae526f5af3d7fbc73751501dcb3425`,
alloue onze préfixes UUID neufs. Le harnais exécuté est archivé au SHA
`ba531acfa80e4b3a4a2f0d1d91aaf3bff3ac9b2f683d0dddd3e2f5594c0de171`.

Chaque cas emploie A, B et un observateur indépendants ; le PID de A doit figurer
dans `pg_blocking_pids(B)` avant son commit. L'observateur voit l'état complet
initial pendant l'attente. Les vérifications terminales portent sur les trois
montants, les lignes et allocations, les applications/snapshots/bibliothèque,
les états de revue/candidat/brouillon/fragments et les reçus.

| Entrelacement exécuté | Résultat observable |
|---|---|
| Même clé, même demande | Une application ; reçu et identités identiques en rejeu |
| Même clé, demande différente | Conflit d'idempotence, aucun second effet |
| Deux clés, même CAS | Second écrivain obsolète ; candidat non sélectionné conservé |
| Revue puis application | Nouvelle désignation et empreinte ; ancienne revue refusée |
| Application puis revue | Sous-détail appliqué, nouvelle revue refusée |
| Rejet puis application | Candidat rejeté, brouillon et fragments archivés, application refusée |
| Application puis rejet | Application conservée, rejet refusé |
| Abandon puis application | Reçu négatif exact, aucun ouvrage appliqué |
| Application puis abandon | Reçu positif conservé, aucun inverse financier |
| Clôture de génération puis application | Ancien brouillon/fragments archivés, nouveau préservé, application refusée |
| Application puis clôture de génération | Ouvrage appliqué préservé ; nouveau, autre auteur et partiels préservés |

Le run `native/concurrency-runs/073d8e22e00a487e` a passé les onze scénarios et
conservé toutes les lignes préexistantes ainsi que le schéma et les droits.
Son manifeste initial reste **failed**, SHA
`86c10207af0155d19d0ae2766a4d8faff1218a97c7c65f83387316c3c672f80c` :
le lecteur d'inventaire n'avait pas compté les règles et paramètres des tenants
personnels créés automatiquement pour les comptes de test. Ces tenants ont des
UUID aléatoires ; leur `created_by` identifie bien les acteurs synthétiques.

La réconciliation distincte `reconciliation-01/receipt.json`, SHA
`12d0d4669ceb031ec2bb213e92d5cc9b0fc23a41cd846d59bf6e9c632ca191a5`,
est **verified**, `databaseReadOnly:true`, `rerun:false`. Elle vérifie les
1 112 artefacts originaux, les anciens tenants reconstitués par leurs empreintes,
les 55 parents signup présents dans l'inventaire archivé et l'égalité de la base
courante avec l'état terminal. L'extension concerne uniquement les 55 règles et
275 paramètres de ces parents ; toutes les autres tables gardent la règle de
préfixe initiale. Les multiensembles complets d'ajouts correspondent exactement.
Les neuf artefacts de réconciliation sont vérifiés ; aucune course n'est rejouée.

Le futur harnais a reçu la même correction bornée, version originale conservée.
Les fixtures restent identifiées ; aucune purge ni réparation métier n'a eu lieu.
Le pgTAP n'a pas été rejoué après les courses : le schéma et les droits sont
identiques à l'installation déjà qualifiée. Ces onze interleavings ne constituent
pas une matrice exhaustive de révocations de droits, de changements de tarifs ou
de protocoles HTTP. Les traces d'acteurs SQL synthétiques ne prouvent pas une
authentification navigateur.
