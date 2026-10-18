# Publication du lot 2 — 18/10/2026

Production finale : **0.5.0**, commit
`708ae88da6c4ae4be70891f1cdefb46534901289`, déploiement
`dpl_91hiCztR8VZ675sR4n1ASKgtGhrj` READY sur
`https://hex-bc.vercel.app`. Création v3, persistance/relecture et reprise durable
vérifiées sur cette publication. Recharger les onglets ouverts avant publication
pour charger le nouveau client.

## Cible et autorisation

Le propriétaire a demandé explicitement le déploiement urgent du lot 2, la
réparation du cron et le triage/fusion des PR automatiques. Il a ensuite autorisé
explicitement la copie de la clé serveur du Supabase `ijropnynpwjbllievrip` vers
la variable privée Vercel `SUPABASE_SERVICE_ROLE_KEY`, ainsi qu'un nouveau
`CRON_SECRET` commun à Vercel production et GitHub Actions. Aucune valeur de
secret n'est enregistrée dans ce document ni les preuves.

Projet Vercel : `hex-bc` (`prj_nl7wu5aMFq5Iut6pkoidfGXHXmVR`), équipe
`team_fTYu5hEO9r6by5YJXnrRSNWG`, dépôt `maxlemeur/HEX_BC`.

Source de la première publication urgente : `13c697b5603ff12d25b8852d925496e102630b10`, commit de `main`
contenant le lot 2, M8 et #70. Le `main` concurrent `45b9e1cf` ajoute le
découpage CI #69 ; il n'est pas embarqué dans ce déploiement.

## Préconditions vérifiées

- Ancienne production READY : `dpl_8itRJ84ayzheqKL4cehu5Rru2Jt8`, commit
  `3d8d2f8a6e98789b03b238c79958007c15069330`.
- Les quatre corps de fonctions de 2.8b/M8 sur le partagé sont identiques aux
  corps attendus : création `7167bf9a7a81b90a4b830a4abc550341`, écrivain
  `7bc2f6c5702364b39fa6582cb363591c`, canonicalisation
  `362d29749467e364fbeb993c89f387e1`, rejeu
  `3c9a289f852e1ae6cad0a15e63348b9a`. Historique M8 `20261018191853`,
  2.8b `20261018191755`. Voir le [reçu partagé](shared-supabase-2-8b-m8-2026-10-18.md).
- CI du commit figé : [qualité](https://github.com/maxlemeur/HEX_BC/actions/runs/39162352347),
  [métier](https://github.com/maxlemeur/HEX_BC/actions/runs/39162352354) et
  [smoke](https://github.com/maxlemeur/HEX_BC/actions/runs/39162352375) réussis.
- Les seuls ajouts de configuration sont les deux secrets serveur Vercel
  production, le secret GitHub `CRON_SECRET` et la variable GitHub `APP_URL`
  (`https://hex-bc.vercel.app`). Aucun fichier `.env` n'est modifié.
- Revue indépendante des scripts opérationnels, de leurs consommateurs et de
  la preuve métier : un défaut d'assertion corrigé avant exécution (vérifier
  `CONTEXT_CHANGED`, pas seulement un HTTP 409), puis suivi ciblé sans constat.

## Qualification complémentaire

Commande : `npm run check:release`, sources figées ci-dessus, `npm ci` sous
Linux Node 24.14.0, copie isolée `/tmp/miaouffrage-lot2-release-13c697b5-linux`.

Tentatives conservées, sans modifier les tests ni leurs délais :

1. Copie Windows : deux timeouts dans `native-stack-guard.test.ts` (course de
   processus et SIGTERM) ; 3 287 tests serveur réussis, 14 ignorés. La chaîne
   s'arrête avant jsdom et le build : ce n'est pas un PASS.
2. Premier lancement WSL non-login : mauvais npm Windows sélectionné ; arrêté.
   Nouveau dossier et shell login sélectionnant Node Linux.
3. Archive Linux sans `.git` : le harnais de boucle exige une identité Git,
   échec `Read-only Git source evidence is unavailable`. Preuve de setup
   manquante, pas de correction de produit déduite de cet échec.
4. Même source Linux, identité Git exacte ajoutée au seul dossier jetable,
   `git diff --exit-code` réussi avant exécution : **PASS, code 0** pour
   `npm run check:release`, build Webpack, budgets et smoke HTTP compris.

Les journaux sont conservés dans les copies de qualification ; les échecs de
setup ne sont pas masqués par l'exécution suivante.

Preuves locales conservées à la racine du dépôt :
`.tmp/release-validation-linux-pass.log` (SHA-256
`bda2c0900d1050941ec05a701bfd4eac76a99cc29729cbc2adea81c8ceaf1513`),
`.tmp/release-validation-linux-no-git-failed.log` et
`.tmp/lot2-release-13c697b5/release-validation.log` (tentative Windows).
L'archive source `.tmp/lot2-release-13c697b5.tar` porte le SHA-256
`d5a4e12866928d89b77fdadcd9b300c4ce9900086a551c1e3448b8d7c95a62df` ;
`git get-tar-commit-id` confirme la révision ci-dessus.

## Déploiement et vérification en ligne

Déploiement demandé par API Vercel, connexion Git serveur, SHA explicitement
figé : `dpl_99SfFPARKhFWCB1oSaezLthRB74o`, URL de build
`https://hex-icansw721-maximes-projects-1598be5f.vercel.app`, cible production.
État **READY**, sans erreur d'alias ; `hex-bc.vercel.app` pointait alors vers ce
déploiement. Build du 18/10/2026, 20:29:11–20:32:02 UTC (environ 171 s).

Preuve métier exécutée : un nouveau brouillon ARMY seulement, authentification
ordinaire, aucune politique de tenant modifiée, aucun e-mail envoyé. Vérifier
401 sans secret de cron, 409 `CONTEXT_CHANGED` et zéro projet pour l'ancien
client, puis 201 pour le client compatible, moteur 3, coefficients 1,30 / 1,20,
totaux 0 / 0 / 0 centimes et relecture API 200 : **toutes les assertions passent**
à 20:33:06 UTC. Fixture `ARMY-DEPLOY-2026-10-18T20-32-54-702Z`, version
`f39940c1-efc8-4beb-98d4-6b458775183d`, projet
`14c3a073-c935-46eb-9616-4213d471f470`, brouillon conservé. La page de connexion
publique est aussi ouverte et relue dans le navigateur. Ce contrôle ne remplace
pas une campagne navigateur authentifiée complète en production.

Commande exécutée depuis la racine :
`node --env-file=.env.local .tmp/verify-lot2-production.mjs` (seulement le compte
E2E déjà configuré ; aucune valeur d'environnement dans la preuve). Script
SHA-256 `632f1d8529de25857014a670ebff28096bcbccfffd7a2bc839aed201a046f5ab`.
Résultat `.tmp/lot2-production-business-proof.json`, SHA-256
`5bd398ebb1433662de53457bbf4f2612b96028bb042d15baf6bc82a8792fdbfb`.

Le cron est actif. Le run fautif
[39156788921](https://github.com/maxlemeur/HEX_BC/actions/runs/39156788921)
a été rejoué après publication avec la configuration corrigée : **PASS** à
20:33:19 UTC, job `117782494593`, 11 s. Compteurs : 1 job takeoff à issue inconnue
récupéré, 0 dû, 0 dispatché, 0 échec, 0 mort ; stockage disponible sans erreur,
0 élément traité ; aucun e-mail dû ou envoyé (`emailSkipped=true`, aucune erreur).
Le script conclut `Recovery healthy`. Il s'agit de la relance manuelle du run
planifié existant ; le nouveau déclenchement planifié est vérifié ci-dessous.

Les logs Vercel du nouveau déploiement, filtrés `error`/`fatal` et regroupés par
route sur les dix dernières minutes après ces vérifications, ne rapportent
aucune entrée. Ce relevé ponctuel ne garantit pas les exécutions futures.

## Suite séparée

#17 et #19 sont fermées car dépassées. #21 (setup-node 7.1.0) et #22
(upload-artifact 7.0.2) ont fusionné après revue indépendante et CI complète,
dont les huit phases calc-v3 : `aaaaec03` et `dc7cfa87`, à 20:36 UTC.

Les têtes recalées #16, #18 et #20 ont également fusionné après revue sans
constat et CI verte. Le bot a choisi des versions plus récentes que ses
anciennes PR :

| PR | Version retenue | Tête revue | Merge | Preuve métier |
|---|---|---|---|---|
| #16 | tsx 4.23.15 | `9a8ddf36` | `5b9bbf26` | [39164056640](https://github.com/maxlemeur/HEX_BC/actions/runs/39164056640) |
| #18 | Resend 6.33.0 | `511aefff` | `eb64f26f` | [39164063771](https://github.com/maxlemeur/HEX_BC/actions/runs/39164063771) |
| #20 | user-event 14.6.8 | `c883dd4f` | `8bce5fb5` | [39164060588](https://github.com/maxlemeur/HEX_BC/actions/runs/39164060588) |

Les contrats d'envoi et d'idempotence Resend restent compatibles avec les appels
du produit. Vitest / coverage-v8 restent à 4.1.11 et Next /
eslint-config-next à 16.4.0. Les builds PR ignorés sont visibles comme tels ;
la seconde publication requiert sa propre qualification de build.

La release #15 (0.5.0) a pour tête revue
`84b66a29ccf6508e2eeaab078fc14e48bc83df70`, basée sur
`5b9bbf260b7e260d4e9a93e375dc3f26d39ea156`. Son diff se limite à
`package.json`, `package-lock.json`, `.release-please-manifest.json` et
`CHANGELOG.md` ; elle conserve les cinq dépendances et n'ajoute aucune migration.
Revue indépendante sans constat. La réouverture de la PR déclenche ses propres
contrôles : [qualité](https://github.com/maxlemeur/HEX_BC/actions/runs/39165346530),
[métier/takeoff](https://github.com/maxlemeur/HEX_BC/actions/runs/39165346525),
[RLS](https://github.com/maxlemeur/HEX_BC/actions/runs/39165346502),
[smoke](https://github.com/maxlemeur/HEX_BC/actions/runs/39165346506).
La qualification `npm ci` puis `npm run check:release` réussit (code 0) sur cette
tête exacte, Linux Node 24, dossier isolé
`/tmp/miaouffrage-lot2-release-050-84b66a29ccf6` avec identité Git vérifiée.
Build Webpack, budgets et smoke HTTP réussis. Journal
`.tmp/release-050-validation-linux-pass.log`, SHA-256
`4bdc9cd52fd56956ade09cd66fb0ac619b427bc254790739e407690cbeb8530f`.
Tous les contrôles PR réussissent, y compris les quatre shards métier et les
deux shards takeoff (dernier shard : 9 min 9 s). #15 fusionne à 21:03:04 UTC,
commit `708ae88da6c4ae4be70891f1cdefb46534901289`. L'arbre Git de ce commit et
celui de la tête qualifiée sont identiques :
`c06be01faeebe203289977c427aa2937331ebb22`. Aucun fichier de migration ne diffère
de la première publication. La [release v0.5.0](https://github.com/maxlemeur/HEX_BC/releases/tag/v0.5.0)
est publiée à 21:03:14 UTC, tag pointant exactement vers ce commit.

La seconde publication Vercel porte sur ce SHA figé :
`dpl_91hiCztR8VZ675sR4n1ASKgtGhrj`, URL
`https://hex-948ffg9jh-maximes-projects-1598be5f.vercel.app`.
État final **READY**, `aliasError=null`, alias principal `hex-bc.vercel.app`.
Build du 18/10/2026, 21:03:26–21:06:24 UTC (environ 178 s).

Même vérification métier sur cette publication, sans changer ses assertions :
`node --env-file=.env.local .tmp/verify-lot2-production-050.mjs`.
Le script ne diffère de la première version que par le SHA source et le fichier
de sortie ; suivi indépendant sans constat, SHA-256
`193d2f9be2f10ba51c261cd4774306f0985912a580ba521a5ce182881a35e15d`.
**PASS** à 21:07:13 UTC : 401 sans secret ; ancien client 409 `CONTEXT_CHANGED`,
zéro projet écrit ; nouveau client 201, brouillon moteur 3, coefficients
1,30 / 1,20, totaux 0 / 0 / 0 centimes, relecture 200.
Fixture `ARMY-DEPLOY-2026-10-18T21-07-05-566Z`, version
`d793a9f0-3d47-4a47-ae30-6f9e72c270bf`, projet
`af8c2e61-553b-4f5d-88b7-db0090d722bf`, brouillon conservé.
Preuve `.tmp/lot2-production-050-business-proof.json`, SHA-256
`ce977a8208c9e112a59e6b48c49e79f37d650c27b8f9128fd8764204bae6d390`.

Le run de reprise `39156788921`, tentative **3**, réussit sur cette nouvelle
publication : job `117790180388`, 21:07:23–21:07:30 UTC. Tous les compteurs
d'opérations, d'échecs et d'erreurs sont à zéro ; `storageSkipped=false`,
`emailSkipped=true`, `Recovery healthy`. Aucune livraison d'e-mail n'est prouvée
par ce run sans e-mail dû. Journal de suivi `.tmp/recovery-050-replay.log`.
Il s'agit encore d'une relance manuelle ; le nouveau déclenchement planifié est
vérifié ci-dessous.
Le relevé Vercel `error`/`fatal`, dix dernières minutes, limité à ce déploiement,
ne contient aucune entrée après ces contrôles.

Les contrôles post-fusion du commit publié sont maintenant tous terminés et
réussis, sans relance :

| Contrôle sur `708ae88d` | Résultat | Preuve |
|---|---|---|
| Quality Gate | PASS | [39166083733](https://github.com/maxlemeur/HEX_BC/actions/runs/39166083733) |
| TesterArmy anonymous smoke | PASS | [39166083736](https://github.com/maxlemeur/HEX_BC/actions/runs/39166083736) |
| TesterArmy Critical, quatre shards et agrégat | PASS | [39166083747](https://github.com/maxlemeur/HEX_BC/actions/runs/39166083747) |
| Release Please | PASS | [39166083765](https://github.com/maxlemeur/HEX_BC/actions/runs/39166083765) |

Le run métier se termine à 23:11:47, heure de Paris (21:11:47 UTC). Les shards
takeoff ne sont pas sélectionnés sur ce push ; leurs deux exécutions réussies
sur la PR sont conservées comme telles, sans prétendre les avoir rejouées ici.

Le [run de reprise 39167352001](https://github.com/maxlemeur/HEX_BC/actions/runs/39167352001),
événement **schedule**, source `708ae88d`, réussit également sans relance : job
`117792968362`, fin à 23:20:08, heure de Paris (21:20:08 UTC). C'est cette fois
un nouveau déclenchement planifié après configuration et publication. Le script
conclut `Recovery healthy` ; tous les compteurs d'opérations et d'erreurs sont
à zéro, `storageSkipped=false`, `emailSkipped=true`. Ce run sans e-mail dû ne
prouve aucune livraison d'e-mail.

L'optimisation v3 attend les sessions de copie v1/v2 et réordonnancement. Le
ménage partagé et la proposition de lot 3 sont décrits dans la
[rétrospective](lot2-retro-lot3-plan-2026-10-18.md). Aucune migration ni
réconciliation d'historique distante n'a été exécutée pendant ce déploiement.
