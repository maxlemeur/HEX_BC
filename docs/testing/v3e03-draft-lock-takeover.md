# V3E03 : reprise forcée du bail perdue contre une acquisition en vol

Flake signalé le 18/10/2026 sur le parcours `V3E03` (sous-lot 2.6,
`e2e/army/local/engine-v3-editor.e2e.ts`) : rouge dans une des trois exécutions
locales C4 à C6 de la PR #41, puis 2 fois sur 16 mesurées dans la boucle de
développement (ci-dessous). `PATCH /api/estimates/<id>/lock?force=true` répond
409 et le serveur journalise `23505` sur `draft_locks_version_id_key`.
Décision : défaut produit, corrigé en base ; le parcours n'est pas modifié.

## Preuve du flake

Run critique `2026-10-18T08-12-58-870Z-critical` du clone WSL
`~/miaouffrage-totals-bulk` (lu sans écriture), run SDK
`01a14e14-6599-7565-9615-7bf061c02ac9`, version `b669f9e2-d78b-4dde-95d8-b31cc1689a2a` :

| Heure (UTC) | Étape du parcours |
| --- | --- |
| 08:20:17.521 | `checkpoint("suggestion")` recharge l'éditeur (`browser.reload`) |
| 08:20:17.718 | grille visible ; lectures écran puis API (`readConsistent`) |
| 08:20:18.181 | `releaseOfferForPreselection` envoie `PATCH …/lock?force=true` |
| 08:20:18.442 | réponse `409 Conflict` (`engine-v3-editor-support.ts:286`) |

`logs/app.log` contient le seul `Supabase error` 23505 sur
`draft_locks_version_id_key` de cette version. Ce journal vient de
`mapSupabaseError` : `acquireLock` traite son propre 23505 sans l'appeler, donc
l'erreur est celle de la RPC `takeover_estimate_draft_lock`.

Base de référence avant correction, boucle `e2e:army:dev-loop` sur `5cfd4a94`
(base de la branche, et des preuves antérieures à la fusion d'`origin/main`), build `CGjWY_v7ljuk_Q-nTpyON`, session
`.e2e/army/ci/2026-10-18T09-16-37-167Z-dev-loop` du clone `~/miaouffrage-v3e03` :
`V3E03` 16 fois, 2 échecs (itérations 007 et 009), tous deux
`expected 409 to be 200` à la ligne 286 avec le même 23505 dans `app.log`.

## Cause

`takeover_estimate_draft_lock` (migration `20260820194939`) prend le verrou
consultatif transactionnel de la version, supprime la ligne de bail puis insère
la sienne. L'acquisition ordinaire (`acquireLock`, `POST /lock`) est un
`INSERT` PostgREST qui ne prend pas ce verrou. En READ COMMITTED, quand aucune
ligne de bail n'est vivante :

1. l'`INSERT` de l'acquisition est écrit, pas encore validé ;
2. le `DELETE` de la reprise ne voit pas cette ligne et ne l'attend pas ;
3. l'`INSERT` de la reprise trouve l'entrée d'index unique en cours, attend
   la transaction de l'acquisition (`Lock/transactionid`), puis échoue en 23505 ;
4. `mapSupabaseError` en fait 409 « Conflit de données. » ; l'autre page garde le bail.

Le commentaire de `20260820194939` (« never observes an unlocked gap ») ne vaut
que si une ligne existe : l'écart existe dès que le bail a été libéré ou expiré.

Dans `V3E03`, le rechargement de `checkpoint` libère le bail au `beforeunload`
puis la nouvelle page l'acquiert au montage (`useDraftLock`), avec la même
identité de page restaurée depuis `sessionStorage`. Le parcours envoie la
reprise forcée environ 660 ms après le rechargement, pendant cette acquisition.

## Un utilisateur réel peut-il l'atteindre ?

Oui, rarement. Un admin dispose de « Forcer le déverrouillage »
(`EstimateEditorAlerts`, `useDraftLock.forceUnlockAndAcquire` → même
`PATCH ?force=true`). Une acquisition ordinaire part de toute page d'éditeur : au
montage ou au rechargement, toutes les 5 s tant que le bail est tenu ailleurs, au
retour de focus ou de visibilité. Il faut qu'aucune ligne ne soit vivante
(bail libéré à la fermeture ou au rechargement d'un onglet, ou expiré et nettoyé)
et que les deux requêtes se croisent. Cas concrets : l'admin clique pendant que
le détenteur recharge sa page, ou pendant que la relance automatique de son
propre onglet part juste après le départ du détenteur. Effet : l'action forcée
échoue avec un message générique et l'autre page garde la main ; aucune donnée
n'est corrompue. La séquence du parcours (reprise forcée pendant le chargement
d'une page) est donc possible : rien à changer côté parcours.

## Défaillances visées et scénarios

| Défaillance | Scénario |
| --- | --- |
| F1 La reprise forcée perd contre une acquisition en vol (23505, 409) | `LOCK02` partie 1 : 200, bail à la page de reprise, page acquéreuse évincée, renouvellement 200 |
| F2 Une acquisition vole une reprise en vol (propriété affaiblie) | `LOCK02` partie 2 : 409 `CONFLICT`, détenteur = autre page du même utilisateur, une seule ligne, celle de la reprise |
| F3 Interblocage ou délai entre acquisition et reprise | `LOCK02` : les deux attentes observées puis levées par le commit, réponses exactes |
| F4 RLS, identité du bail ou isolation tenant affaiblies | pgTAP et matrice RLS au démarrage de la boucle ; `LOCK02` insère par RLS avec le rôle `authenticated` |
| F5 Le flake `V3E03` persiste | `V3E03` au moins dix itérations consécutives, puis run qualifiant |
| F6 Renouvellement ou libération changés | aucun verrou ajouté sur `UPDATE`/`DELETE` ; heartbeat des parcours V3E, `LOCK01` |

`LOCK02` (`e2e/army/local/tech-debt-lock-boundaries.e2e.ts`) rend la course
déterministe sans attente temporisée : la moitié en vol est une seconde session
PostgreSQL de la pile possédée, ouverte dans sa transaction avec le rôle et les
claims JWT du propriétaire, comme PostgREST ; la requête HTTP réelle part ;
le parcours attend que `pg_blocking_pids` montre cette requête bloquée par la
session tenue, puis la valide. Propriétaire dédié (admin de son propre tenant),
brouillon neuf sans bail au départ. Les identités de session restent en mémoire ;
les preuves ne gardent que statuts, codes et booléens. Pas d'isolation Vitest
ou pgTAP : la course se reproduit par la route réelle, et pgTAP ne tient pas deux
sessions.

## Rouge

`LOCK02` 3 fois sur 3 rouge (itérations 017 à 019 de la même boucle,
source `5cfd4a94` plus le diff du parcours, identique au commit `f8afdfae`) :
`expected [409,false,"CONFLICT","23505"] to equal [200,true,null,null]` ; la
reprise attendait `Lock/transactionid`, la page acquéreuse gardait le bail,
le renouvellement de la page de reprise recevait 409. Chaque run ajoute le même
23505 à `app.log`.

## Correction

Migration `20261018093005_serialize_estimate_draft_lock_acquisition.sql`, plus
récente que toutes celles d'`origin/main`, au commit puis après la fusion
d'`origin/main` `80d90011` (dernière : `20261018013249`) : le trigger `BEFORE INSERT`
de `draft_locks` (`assign_draft_lock_tenant_id`) prend le même verrou
consultatif que la reprise (`hashtextextended(version_id::text, 0)`) avant
d'atteindre l'index unique. Une reprise qui attend supprime l'acquisition
validée et prend le bail ; une acquisition qui attend trouve la reprise validée
et reste refusée (23505 → conflit de bail dans `acquireLock`). Le verrou est
réentrant pour l'`INSERT` de la reprise. RLS, identité immuable, affectation du
tenant, renouvellement et libération sont inchangés ; aucun code TypeScript,
aucune route, aucun type ni OpenAPI ne change.

Écartés : une RPC d'acquisition (nouvelle surface de droits et d'autorisation
pour le même verrou) ; un `ON CONFLICT DO UPDATE` (refusé par l'identité
immuable du bail, et il ne sérialise pas l'acquisition) ; une boucle de reprise
sur 23505 (elle masque la course au lieu de l'ordonner).

## Preuves

Boucle relancée sur `59a74027` (la migration change la pile), build
`b5bklYe3Dh1VMAKs5nHyS`, session `.e2e/army/ci/2026-10-18T09-34-32-534Z-dev-loop` :
migrations, pgTAP (22 fichiers, 1 886 tests) et matrice RLS verts au démarrage.

| Contrôle | Résultat |
| --- | --- |
| `run --grep LOCK02`, itérations 001 à 003 | 3/3 verts ; reprise et acquisition attendent `Lock/advisory` ; 200 puis 409 `CONFLICT` exacts ; aucun 23505 journalisé |
| `run --grep V3E03`, itérations 004 à 028 | 25/25 verts consécutifs |
| `run --grep LOCK02` après revue (`a073ea9d`, attente liée à l'`INSERT`), itérations 029 à 031 | 3/3 verts |
| `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E\|V3P01\|V3FC" --app-port 3176` sur `a073ea9d`, sans changement local | sortie 0 ; 17/17 : 16 parcours (V3E01 à V3E04, 9 de `engine-v3-editor-actions`, V3P01, V3FC01, V3FC02) et le setup, aucun skip ni retry ; 240,9 s ; `.e2e/army/ci/2026-10-18T09-49-34-015Z-critical` (`manifest.json` sha256 `16b785c4…070e`), run SDK `01a14e6c-038c-71a8-b73a-06c4affc3db7` |
| `npm run e2e:army:local -- --grep "LOCK0" --app-port 3176` sur `a073ea9d` | sortie 0 ; 3/3 : LOCK01, LOCK02 et le setup ; `.e2e/army/ci/2026-10-18T09-55-44-389Z-critical` (`manifest.json` sha256 `dd650cb3…db1a`), run SDK `01a14e71-cfe9-76b0-8569-2b9bc7c40cb7` |
| `npm run typecheck` ; `eslint` des deux parcours touchés | sortie 0 ; sortie 0 |
| Vitest node : `locks.test.ts`, `lock/route.test.ts`, `supabase-migration-history-regressions`, `supabase-migration-git-guard`, `army-impact-map` ; jsdom : `useDraftLock.test.ts` | 35/35 ; 22/22 |
| `git diff --check` de la branche | sortie 0 |

Re-preuve après la fusion d'`origin/main` `80d90011`, sur la tête fusionnée
`61bb751a` sans changement local (`diffSha256` vide), `E2E_ARMY_WORKERS=2` :

| Contrôle | Résultat |
| --- | --- |
| `npm run e2e:army:local -- --grep "LOCK0" --app-port 3176` | sortie 0 ; 3/3 (LOCK01, LOCK02, setup), une tentative chacun ; 107 s ; `.e2e/army/ci/2026-10-18T10-22-00-289Z-critical` (`manifest.json` sha256 `fcc186be…a408`), run SDK `01a14e89-be69-75fa-8715-d1034a7f6e7a` |
| `npm run e2e:army:local -- --grep "V3E\|V3P01\|V3FC" --app-port 3176` | sortie 0 ; 17/17 (V3E01 à V3E13, V3P01, V3FC01, V3FC02, setup), une tentative chacun, aucun skip ; 300 s ; `.e2e/army/ci/2026-10-18T10-23-47-266Z-critical` (`manifest.json` sha256 `46cd82fe…d588`), run SDK `01a14e8b-08ad-71ea-979f-75507d64ae1c` |
| `app.log` des deux runs après le dernier « Ready in » | aucun `draft_locks_version_id_key` (les 5 entrées antérieures viennent de la boucle de référence) |
| `npm run supabase:migrations:git-guard -- --base 80d90011…`, modes `local` et `pull_request` | sortie 0 ; 2 changements dans le périmètre |
| `npm run typecheck` | sortie 0 |
| Vitest node : les cinq suites ci-dessus et `supabase-migration-restamp` ; jsdom : `useDraftLock.test.ts` | 58/58 ; 22/22 |
| `git diff --check 80d90011...HEAD` | sortie 0 |

Les preuves sont dans le clone WSL `~/miaouffrage-v3e03` (Node 24.19.0, Ubuntu
24.04, pile native possédée détruite après chaque run). Aucun module Vitest
n'est touché par la branche : les suites listées sont celles du verrou et des
migrations.

## Limites

- Les itérations de boucle ne sont pas des runs qualifiants ; les runs
  qualifiants sont ceux des tableaux. `LOCK02` est hors du motif `V3E|V3P01|V3FC`
  et a son propre run.
- Avant correction, `V3E03` échouait 2 fois sur 16 : 25 verts consécutifs
  auraient encore environ 3,5 % de chances avec le défaut ((14/16)^25). La
  preuve du mécanisme est `LOCK02`, déterministe ; la série `V3E03` la complète.
- Les sélections manuelles `tech-debt-lot1` et `army-021` de `e2e.config.ts`
  incluent ce fichier : sans route SQL locale (`E2E_ARMY_LOCAL_DB_URL`),
  `LOCK02` y échoue explicitement au lieu de passer.
- Le verrou est pris dans un trigger `BEFORE`, donc avant le contrôle RLS : un
  `INSERT` refusé d'un autre tenant le tient le temps de sa propre instruction
  (mono-instruction par PostgREST). C'est la seule contention que la
  correction ajoute.
- Comportement préexistant, inchangé : deux `INSERT` concurrents de plusieurs
  baux, en ordre inverse, s'interbloquent déjà sans la migration (40P01), par
  l'index unique ; le verrou consultatif déplace seulement cette attente dans
  le trigger `BEFORE`. Aucun chemin applicatif ne le fait ; seules des fixtures
  SQL mono-session insèrent plusieurs baux.
- Variante non exécutée : un `INSERT` ordinaire validé strictement entre le
  `DELETE` et l'`INSERT` de la reprise. Aucun test ne l'exécute, faute de pause
  injectable dans la RPC. La correction la ferme par construction : l'`INSERT`
  d'acquisition attend désormais le verrou consultatif, que la reprise prend
  avant son `DELETE`.
- La partie 2 de `LOCK02` n'a tourné qu'après correction (la partie 1 échoue
  avant elle) ; son 409 avant correction se déduit de la même attente d'index.
- La moitié en vol de `LOCK02` est un `INSERT` SQL tenu ouvert, pas un second
  onglet : seule une session tenue fixe l'ordre des commits.
- Les `app.log` d'un même checkout s'accumulent d'un run à l'autre : lire la
  dernière section après « Ready in » (constat préexistant, non corrigé ici).
- La migration n'est pas appliquée au Supabase partagé : opération distante à
  autoriser à part, avant tout déploiement du code qui en dépend.
