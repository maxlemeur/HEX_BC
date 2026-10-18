# Copies v1/v2 d'environ 1 000 lignes en une instruction

Défaut antérieur au lot 2, relevé par le correctif de la limite de lignes
([copy-row-limit-v2.md](copy-row-limit-v2.md), run 1, PR #70) : copier
environ 1 000 éléments dans un brouillon v1/v2 répondait 400 après ~8,2 s et n'écrivait rien
(`57014 canceling statement due to statement timeout`, `statement_timeout` de 8 s des rôles de l'API). Les copies vers
une v3 passent par l'écrivain par lot (`commit_estimate_batch`, sous-lot 2.8b, PR #59) et ne sont pas concernées.

Chemins (`src/lib/estimates/server.ts`) :

- `duplicateSectionInternal` : `POST /api/estimates/{v}/sections/{s}/duplicate` ;
- `importSectionsFromVersion` : `POST /api/estimates/{v}/import-sections`, modes `append` et `merge` ;
- `importLinkedDpgfSourceIntoVersionInternal` : `POST /api/estimates/{v}/import-linked-dpgf`.

Chacun insérait ses éléments par un seul `supabase.from("estimate_items").insert(...)` au nom de l'utilisateur.

## Où passait le temps (mesuré avant le choix)

Pile native possédée (clone Linux sous WSL, PostgreSQL 17.11), version v2 neutre, section de 999 lignes
(1 000 éléments), insertion faite comme PostgREST (`json_populate_recordset`, rôle `authenticated`, jeton de
l'utilisateur ARMY), `EXPLAIN ANALYZE` par déclencheur et `pg_stat_xact_user_functions` (temps propre par fonction),
chaque essai annulé :

| Essai | Durée | Détail |
| --- | --- | --- |
| 1 000 éléments dans une v2 vide, chemin actuel | **16,3 s** | garde de profondeur `estimate_items_hierarchy_depth_guard` 14,5 s ; 2 016 000 appels de `is_tenant_member` |
| 1 000 éléments dupliqués sur place dans une v2 de 1 000 éléments créée en bloc | 3,6 s | garde de profondeur 1,95 s ; 18 000 `is_tenant_member` |
| idem, v2 amorcée ligne à ligne (1 000 relèvements de révision dans son historique) | 3,8 s | même profil : l'historique d'amorçage n'est pas la cause |
| 100 éléments dans la v2 vide | 0,51 s | garde de profondeur 0,34 s |
| contrat de création posé, rôle `authenticated` | ~610 ms + ~115 ms de rejeu | les gardes encore par ligne (`guard_estimate_v2_snapshot_columns`, `guard_estimate_item_engine_columns`, `assign_tenant_id`) et la politique d'insertion évaluent les politiques RLS : 12 `is_tenant_member` par ligne |
| contrat de création posé, sans RLS (propriétaire) | **~65 ms + ~90-120 ms de rejeu** | |

Cause principale : `validate_estimate_item_hierarchy_depth` est `security invoker` ; sa remontée récursive des
parents lit `estimate_items` à travers la politique SELECT. Dans une cible qui se remplit pendant l'instruction, le
plan parcourt les éléments déjà insérés de la version à chaque ligne : coût quadratique (2 016 000 appels ≈ 4 par
ligne parcourue × 500 500 lignes parcourues, plus 12 par ligne insérée). S'y ajoutent, par ligne, le relèvement de révision
de la version avec sa ligne d'audit, la ligne d'audit de l'élément et la recherche de couverture des sources
(0,1 à 0,4 s chacun pour 1 000 lignes). Le contrat de création seul ne suffit pas : à 610-725 ms localement, un
facteur CI de 12 à 19 (voir [large-estimate-statement-budget.md](large-estimate-statement-budget.md)) redépasse 8 s.
Il faut à la fois vérifier l'autorisation une seule fois et rejouer les effets par élément en bloc.

## Défaillances observables (écrites avant le code)

| Id | Chemin | Défaillance sur `main` |
| --- | --- | --- |
| LC1 | Dupliquer sur place une section de 999 lignes (1 000 éléments) d'un brouillon v2 | 400 après ~8,2 s (`57014`), rien d'écrit |
| LC2 | Importer cette section dans un autre brouillon v2 vide (`append`) | idem |
| LC3 | Fusionner cette section dans une section de même titre (2 lignes) d'un autre brouillon (`merge`, 999 lignes ajoutées sous une section qui n'est pas dans la charge) | idem |
| LC4 | Importer un DPGF lié de 1 001 lignes chiffrées dans un brouillon v2 (1 002 éléments ; 1 000 lignes avant la fusion de #70) | idem |
| LC5 | Témoin, vert avant le correctif : dupliquer sur place une section de 12 lignes | — ; fixe les effets attendus d'une copie : une révision par élément inséré plus une pour les totaux, une ligne d'audit par élément et par pas de révision, toutes au nom de l'utilisateur |

Toute copie doit répondre 201 et stocker chaque ligne : nombre, positions, empreinte md5 du contenu (titre, quantité,
prix, totaux, coefficients, provenance, `source_metadata`), totaux enregistrés égaux aux sommes SQL des lignes et aux
totaux relus par l'éditeur, puis les effets de LC5. Montants v1/v2 inchangés : `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` ne sont pas modifiés, la copie reprend les colonnes de la ligne source et le
recalcul (`recalculateEstimateVersionTotals`) est inchangé.

Chaque lecture du parcours reste à 1 000 lignes au plus (`max_rows` de PostgREST) : il ne dépend pas de la pagination
de [copy-row-limit-v2.md](copy-row-limit-v2.md), sauf LC4 qui, depuis la fusion de #70 (lectures par pages), passe à 1 001 lignes chiffrées.

## Correctif

Migration `supabase/migrations/20261018193516_estimate_copy_items_set_based.sql` : nouvelle fonction
`public.copy_estimate_items_atomic(p_version_id, p_draft_lock_session_id, p_items)`, sans modification de
déclencheur ni de fonction existante.

1. `security definer`, exécutable par `authenticated` seulement. `auth.uid()` désigne toujours l'utilisateur : chaque
   ligne d'audit garde son auteur. Elle vérifie une fois ce que la politique d'insertion d'`estimate_items` vérifiait
   par ligne : version existante et brouillon, membre du tenant de la version avec le rôle admin ou ingénieur,
   propriétaire de l'affaire sauf admin (`is_tenant_member` et `has_tenant_role`, exception de l'administrateur de
   plateforme comprise). Elle exige en plus le bail de verrou vivant de l'utilisateur pour la session de la page,
   comme l'écrivain par lot, et le tient jusqu'au commit (`for key share nowait` : une reprise forcée en cours est un
   refus 409, jamais un interblocage avec le verrou de la version ; le renouvellement du bail n'est pas bloqué).
2. Moteurs 1 et 2 seulement : une v3 est refusée (`ESTIMATE_V3_WRITER_NOT_SUPPORTED`), comme le faisait déjà le
   déclencheur `guard_estimate_item_engine_columns`.
3. Chaque élément porte toutes les colonnes copiées (et rien d'autre ; `tenant_id`, `version_id` seulement s'ils sont
   ceux de la version) : la ligne stockée est celle qu'énonce la copie, sans défaut de colonne à deviner. Les
   identifiants sont uniques, un parent copié précède ses enfants.
4. Sous `miaouffrage.estimate_creation_atomic` lié à la version (contrat de la création atomique,
   `20261018013249`), les déclencheurs par élément (révision, audit, couverture, profondeur) laissent les éléments à
   `public.estimate_creation_replay_item_effects_for_writer`, qui les rejoue dans l'ordre de la charge : profondeur
   de chaque élément sur ses parents, sections déjà présentes dans le brouillon comprises (remontée bornée par
   `greatest(item_count, max_section_depth)` depuis `20261018180306`, #59, que le préalable de la migration exige),
   avec les messages de la garde par ligne ; un pas de révision et une ligne d'audit de version par élément ; une
   ligne d'audit par élément inséré ; l'invalidation de couverture. Les autres déclencheurs, contraintes et clés
   étrangères s'exécutent inchangés. La valeur précédente du contrat est restaurée.

Côté serveur, `src/lib/estimates/copy-items-server.ts` (`insertCopiedEstimateItems`) remplace les trois insertions ;
les contrôles existants restent avant l'appel (accès à la version, brouillon, verrou de la page, refus des moteurs).
Le type `CopiedEstimateItem` impose au compilateur la liste complète des colonnes. Le DPGF lié écrit désormais
explicitement les valeurs que les défauts de colonne donnaient à sa section et à ses lignes (`null`, `{}`).
Refus : `42501` (403 `FORBIDDEN`), `55000 ESTIMATE_COPY_LOCK_REQUIRED` (409 `LOCK_REQUIRED`), `22023` (400).

## Contrôles

- Parcours TesterArmy `e2e/army/local/estimate-copy-large-v2.e2e.ts` (LC01 à LC05), sur la pile native possédée ;
  contenu volumineux semé en SQL, chaque copie comparée à SQL.
- pgTAP, chaque `db:ci:local` : `supabase/tests/database/estimate-copy-items-atomic.test.sql` (fixture partagée
  `supabase/tests/fixtures/copy-items-estimate.sql`). Exception d'isolation : la fonction est appelable par tout
  utilisateur authentifié via PostgREST, son autorisation est la frontière, et les parcours ne l'atteignent qu'à
  travers l'API qui vérifie avant elle ; l'équivalence fine avec le chemin par élément et le nombre de mises à jour de
  la version ne sont pas observables par un parcours avant le dépassement lui-même. 22 assertions :
  droits d'exécution ; 13 éléments copiés par la fonction et par une insertion PostgREST au nom du propriétaire
  (lignes aux colonnes copiées toutes distinctes : `aid`, trois rôles MO, heures et coefficients atelier et chantier,
  fichier et page source, `source_metadata`) : mêmes lignes stockées (toutes colonnes hors identifiants et
  horodatages), même révision, mêmes lignes d'audit au même auteur, 13 mises à jour de version contre 1 ; contrat
  refermé après l'appel ; 1 000 éléments en une instruction, une mise à jour de version, révision + 1 000, 1 000 lignes
  d'audit d'insertion ; fusion sous une section existante ; admin du tenant sur l'affaire d'un autre ; profondeur sous
  des sections existantes (pas de section au niveau 4, ligne et section de niveau 3 admises, pas de parent d'une autre
  version, pas de ligne parente) ; version et tenant écrits en majuscules dans la charge ; refus : sans utilisateur,
  autre tenant, lecteur, ingénieur non propriétaire (403), sans session, autre session, verrou d'un autre, bail expiré
  (409), charge vide, incomplète, élargie, d'une autre version ou d'un autre tenant, doublonnée ou mal ordonnée (400),
  ligne sans parent, version non brouillon, v3 ; aucun refus n'écrit.
- Budget, opt-in (`DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local`) :
  `supabase/tests/budget/estimate-copy-statement-budget.test.sql`, médiane de 7 copies annulées de 1 000 éléments par
  le propriétaire, au rôle de l'API, ≤ 330 ms (dérivation dans
  [large-estimate-statement-budget.md](large-estimate-statement-budget.md)).

## Exécutions

Clone Linux sous WSL (`~/miaouffrage-copyinsert`, Node 24.14.0, Supabase CLI 2.120.0, PostgreSQL 17.11, 24 cœurs),
pile native possédée de la boucle `e2e:army:dev-loop` (port applicatif 3176). Les itérations de la boucle réutilisent
la pile et ne sont pas des runs qualifiants. Preuves copiées dans `.codex-tmp/copy-large-v2/` du worktree (ignoré
par git, non durable) : `red-iteration/`, `green-iteration/` (manifeste, journal des parcours, artefacts métier,
`logs/app.log`), `measure/` (scripts et sorties des mesures SQL), `verify/`.

| # | Source | Commande | Résultat |
| --- | --- | --- | --- |
| M | `main` `36c5158c`, fixtures SQL (une v2 vide, deux v2 de 1 000 éléments) | `EXPLAIN ANALYZE` et `pg_stat_xact_user_functions`, puis chronométrage psql, chaque essai annulé (`measure/m-*.sql`) | Tableau « Où passait le temps » |
| 1 | `main` `36c5158c` + parcours (première forme : preuves sans l'objet d'erreur complet), sans correctif | `npm run e2e:army:dev-loop -- run --files e2e/army/local/estimate-copy-large-v2.e2e.ts` (boucle `2026-10-18T16-40-56-668Z`, itération 1) | **Rouge, 4 échecs sur 5, chacun pour la raison attendue** : LC01 à LC04 400 `BAD_REQUEST` après 8 233, 8 217, 8 234 et 8 235 ms, rien d'écrit (révisions 0, audit 0, lignes inchangées) ; `logs/app.log` : quatre `57014 canceling statement due to statement timeout`. LC05 (témoin) vert en 239 ms : 14 révisions, 13 audits d'insertion, 14 audits de version, auteur ARMY |
| 2 | `36c5158c` + correctif + parcours final | même commande (boucle `2026-10-18T17-03-02-679Z`, démarrée sur la migration : migrations, pgTAP complet et matrice RLS verts au démarrage), itération 1 | **Vert, 5 sur 5**, valeurs exactes : LC01 1 000 éléments, empreinte égale à la source, 4 995 000 / 999 000 / 5 994 000 relus et sommés, 1 001 révisions, 1 000 + 1 001 audits ; LC02 999 lignes, 2 497 500 HT ; LC03 1 001 lignes aux positions 1 à 1 001, 2 497 515 HT ; LC04 1 000 lignes, 2 502 500 HT, 1 002 révisions ; LC05 inchangé. Requêtes : LC01 1 243 ms, LC02 654 ms, LC03 639 ms, LC04 669 ms, LC05 162 ms (amorçages 40-793 ms) |
| 3 | idem run 2 | psql sur la pile de la boucle : `supabase/tests/database/estimate-copy-items-atomic.test.sql` | 20 sur 20 |
| 4 | idem run 2 | psql : `supabase/tests/budget/estimate-copy-statement-budget.test.sql`, trois passes | Médianes 198,9, 206,5 et 241 ms (budget 330 ms) ; chaque copie de 1 000 éléments met à jour sa version une fois. Charge de la machine 1,3-2,4 |
| 5 | idem run 2, clone identique à l'octet au worktree | `npm run verify:pr` | Succès en 137 s : node 303 fichiers / 2 939 tests (1 fichier et 2 tests ignorés), jsdom 165 / 831, couverture des frontières critiques 3 / 12 |

Le run 2 a tourné avec `src/lib/estimates/server.ts` et `src/types/database.ts` en fins de ligne LF (CRLF dans le
dépôt) : contenu identique, fins de ligne près ; le run 5 porte sur les fichiers identiques à l'octet. Empreintes
`sha256` des sources des runs 2 à 5 : `server.ts` `97bfefe1…`, `copy-items-server.ts` `f14f47b1…`, migration
`a5acbfc2…`, parcours `8cf41612…`, pgTAP `1ab0af5d…`, fixture `07fe8cb9…`, budget `6073ae76…`. Les corrections de
la revue (ci-dessous) ont ensuite été contrôlées par typecheck, ESLint et une grappe PostgreSQL jetable avec talons
(`.codex-tmp/copy-large-v2/syntax-check/`), puis par les runs qualifiants.

### Runs qualifiants (sources finales)

Après la fusion du lot 2 (pause des runs natifs levée), la branche est avancée sur `main` `e4e3885f` (#59, M8, #67) ;
le correctif y est réappliqué (cinq conflits mécaniques dans `server.ts` : la branche v3 de #59 précède l'appel
v1/v2), sa boucle de profondeur retirée au profit du rejeu corrigé par #59, et la migration restampillée en
`20261018193516` par `npm run supabase:migrations:restamp` (garde Git et manifeste validés). Depuis M8, un tenant
sans politique crée des v3 : la fixture pgTAP pose la politique explicite 2 ; le tenant ARMY l'a déjà
(`run-tester-army-ci.ts`). Empreintes `sha256` des sources (clone et worktree identiques à l'octet) : `server.ts`
`a1166d8a…`, `copy-items-server.ts` `f6f6e834…`, migration `abca1587…`, parcours `8cf41612…`, pgTAP `fb0809e3…`,
fixture `48e585bc…`, budget `6073ae76…`. Preuves : `.codex-tmp/copy-large-v2/qualifying/`.

| # | Source | Commande | Résultat |
| --- | --- | --- | --- |
| Q1 | `main` `e4e3885f` + parcours, `e2e.config.ts` et carte d'impact, sans correctif (`~/miaouffrage-copyinsert-red`) | `npm run e2e:army:local -- --files e2e/army/local/estimate-copy-large-v2.e2e.ts --app-port 3177` (`2026-10-18T19-37-51-741Z-critical`) | **Rouge**, 3 échecs sur 5 : LC02, LC03, LC04 400 `BAD_REQUEST` (`details.code` `57014`) après 8 320, 8 469 et 8 579 ms, rien d'écrit. LC01 201 en **8 246 ms** : l'instruction est passée juste sous les 8 s (le run 1 l'avait vue dépasser en 8 233 ms) ; sur place dans une version de 1 000 éléments, le chemin par ligne reste au bord du délai en local et le dépasse sous la charge de la CI (facteur 12 à 19). LC05 vert. pgTAP et matrice RLS verts |
| Q2 | `e4e3885f` + correctif | même commande, `--app-port 3176` (`2026-10-18T19-48-47-334Z-critical`) | **Vert, 6 sur 6** (connexion comprise), pgTAP complet (dont `estimate-copy-items-atomic`, 22 sur 22) et matrice RLS verts. Requêtes : LC01 1 096 ms, LC02 751 ms, LC03 967 ms, LC04 1 327 ms, LC05 227 ms ; révisions et audits exacts (1 001 / 1 000 / 1 001 ; 1 001 / 1 000 / 1 001 ; 1 000 / 999 / 1 000 ; 1 002 / 1 001 / 1 002 ; 14 / 13 / 14), auteur ARMY. Une première tentative (`2026-10-18T19-37-51-714Z`) s'était arrêtée au pgTAP : fixture sans politique 2 (M8) puis deux cas de profondeur mal semés, corrigés et vérifiés par `npm run db:ci:local -- --files estimate-copy-items-atomic.test.sql --skip-rls` (22 sur 22) |
| Q3 | idem Q2 | `DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local` | pgTAP : 27 fichiers, 2 005 tests, succès. Budget : **échec sous charge**, copie médiane 426,9 ms (249,9 à 621,5) pour 330 ms ; dans le même passage, le budget de référence de `main` (création v3 de 1 021 éléments, ~245 ms sur le Mac) échoue aussi à 722,1 ms. Charge 12 à 14 (banc d'essai Android et navigateurs d'un autre projet dans WSL, en parallèle du run Q2). Au repos (run 4, avant la fusion) : 198,9 à 241 ms. La matrice RLS, qui suit le budget dans ce runner, n'a pas tourné ici ; elle est verte dans Q2 |
| Q4 | idem Q2 | `npm run verify:pr` | Succès : node 308 fichiers / 3 298 tests (1 fichier et 2 tests ignorés), jsdom 165 / 831, couverture des frontières critiques 3 / 12 |

### Après #70 (sources finales)

#70 (lectures par pages des mêmes copies) fusionnée, la branche est avancée sur `main` `13c697b5` ; le correctif se
réapplique sans conflit dans `server.ts` (#70 change les lectures, pas l'insertion). LC04 passe à 1 001 lignes. Le
test d'isolation de #70 (`server.copy-source.test.ts`) enregistre aussi l'appel de la fonction comme une écriture,
pour que « refusé avant toute écriture » garde son sens. Empreintes : `server.ts` `d514d635…`,
`copy-items-server.ts` `f6f6e834…`, `server.copy-source.test.ts` `07504f2a…`, migration `abca1587…`, parcours
`c3111ce1…`, pgTAP `fb0809e3…`, fixture `48e585bc…`, budget `6073ae76…`. Preuves : `.codex-tmp/copy-large-v2/after-70/`.

| # | Source | Commande | Résultat |
| --- | --- | --- | --- |
| A1 | `main` `13c697b5` + parcours, sans correctif | `npm run e2e:army:local -- --files e2e/army/local/estimate-copy-large-v2.e2e.ts --app-port 3177` (`2026-10-18T20-17-25-257Z-critical`), charge ~3 | 6 sur 6 : au repos, l'ancien chemin finit sous les 8 s en local. Requêtes **5 807, 5 815, 5 506 et 5 688 ms** (LC01 à LC04), révisions et audits exacts. Sous charge (Q1) LC02 à LC04 dépassaient le délai ; en CI, au facteur mesuré (médiane 2,4×, p95 ~3,2×), ~5 s deviennent 12 à 16 s |
| A2 | `13c697b5` + correctif | même commande, `--app-port 3176` (`2026-10-18T20-17-25-251Z-critical`) | **Vert 6 sur 6**, pgTAP (27 fichiers) et matrice RLS verts. Requêtes **1 090, 551, 539 et 662 ms** (LC01 à LC04, LC04 à 1 001 lignes), LC05 196 ms ; révisions et audits exacts, auteur ARMY |
| A3 | idem A2 | `DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local`, charge ~2,7 | pgTAP 27 fichiers / 2 005 tests : succès. Budget de la copie : **médiane 208,2 ms** sur 7 (170,0 à 246,6), budget 330 ms, chaque copie met à jour sa version une fois : succès. Le budget de référence de `main` (création v3) échoue sur cette machine à 426,4 ms (~245 ms sur le Mac de référence) : WSL y est ~1,7× plus lent ; l'échec n'est pas celui de ce changement. La matrice RLS, qui suit ce passage, a tourné dans A2 |
| A4 | idem A2 | `npm run verify:pr` | Succès en 84 s : node 309 fichiers / 3 301 tests (1 et 2 ignorés), jsdom 165 / 831, couverture 3 / 12 |

Revue de suivi (lecture seule, sur ces sources) : les trois corrections tiennent (profondeur par le rejeu de #59 et
son préalable, identifiants en majuscules, `for key share nowait` face au renouvellement et à la reprise du bail),
résolutions de fusion et test de #70 corrects, aucun nouveau défaut. Seule suite : un commentaire du pgTAP décrivait
le rejeu d'avant #59, corrigé après les runs (commentaire seulement, empreinte du fichier `2469ad6a…` au lieu de
`fb0809e3…`).

Le rouge déterministe n'est donc pas le parcours en local au repos : c'est le pgTAP (une mise à jour de version au
lieu d'une par élément, à chaque `db:ci:local`, CI comprise) et le budget opt-in (≈ 5 s de requête par copie avant,
≈ 0,2 s d'instruction après). Le parcours garde les valeurs, les effets et la durée sous le délai de la CI.

## Revue indépendante

Une revue en lecture seule (sous-agent, diff stable des runs 2 à 5, intention, contrats, consommateurs et preuves
fournis) : autorisation, équivalence des lignes stockées, contrat de session et statuts HTTP vérifiés sans défaut.
Constats et suites :

| Constat | Gravité | Suite |
| --- | --- | --- |
| Le rejeu de la création ne remonte qu'autant de parents qu'il y a d'éléments : un appel direct (PostgREST) d'un seul élément sous une section de niveau 3 existante l'aurait admis au niveau 4, sans limite en répétant l'appel. Aucun parcours de l'API ne le produisait (la fusion rattache des lignes à des sections racines) | Important | Corrigé d'abord dans la fonction, puis par #59 dans le rejeu lui-même (`20261018180306`, remontée bornée par `greatest(item_count, max_section_depth)`, même constat de sa revue interne) : après la fusion de `main`, la fonction s'en remet au rejeu et son préalable exige cette version. pgTAP : section sous un niveau 3, ligne et section admises, parent d'une autre version, ligne parente |
| Un identifiant de version en majuscules dans la route : refus de la charge, ou erreur 500 après la copie validée (comparaison de chaînes) | Faible | Corrigé : comparaisons insensibles à la casse (SQL et `copy-items-server.ts`) ; pgTAP sur une charge en majuscules |
| Interblocage possible avec une reprise forcée du bail (suppression puis insertion, dont la clé étrangère attend la version verrouillée par la copie) | Faible | Corrigé : `for key share nowait` sur le bail, refus 409 `LOCK_REQUIRED` ; non reproduit (deux connexions) |
| Colonnes copiées laissées nulles par la fixture pgTAP | Finition | Corrigé : lignes de la fixture à valeurs distinctes (`aid`, rôles MO, atelier et chantier, fichier et page) |
| `satisfies CopiedEstimateItem & EstimateItemInsert` admet une clé que la fonction refuse (`line_nature`) | Finition | Laissé : aucune n'est présente ; la fonction la refuserait en 400, jamais en silence |
| LC04 synthétique, alors qu'AGENTS.md demande d'abord les entrées réelles (classeurs OPTIMA) | Processus | Ouvert (limites) : le défaut tient au volume, que LC02 à LC04 reproduisent ; un import réel d'un lot OPTIMA puis du DPGF lié dans un brouillon v2 reste à ajouter |
| `origin/main` a avancé (migrations `20261018102840`, `20261018170351`, `e2e.config.ts`, carte d'impact) | Processus | Fait : branche avancée sur `e4e3885f`, migration restampillée, runs qualifiants rejoués |

## Limites

- Mesures locales sur WSL, pas sur le Mac de référence du budget (où la référence de `main` est ~1,7× plus rapide) ;
  la médiane de la copie (208 ms, A3) laisse ~120 ms de marge.
- Le contrat réutilisé s'appelle encore « création » (`miaouffrage.estimate_creation_atomic`,
  `estimate_creation_replay_item_effects_for_writer`). Depuis #59 il contrôle la profondeur sur les parents stockés
  aussi ; le reste du rejeu (révision, audit, couverture) ne suppose pas une version neuve : pgTAP (équivalence,
  fusion, profondeur) et LC03.
- La reprise forcée concurrente du bail n'est pas reproduite (il faudrait deux connexions) : le refus 409 sur
  `lock_not_available` est relu, pas exécuté.
- Une charge portant deux refus différents peut en signaler un autre en premier (même écart que la création).
- Même cause, non traitée ici : `reorder_estimate_items` et `move_estimate_item` relèvent la révision ligne à ligne
  (~2 s pour 1 001 frères, mesuré par la session de pagination des lectures) ; l'insertion de modèles garde aussi le
  `statement_timeout` de 8 s (`docs/testing/postgrest-completeness-2026-10-18.md`).
- La PR #70 (lectures par pages des mêmes copies) est fusionnée (`13c697b5`) ; la branche a été avancée dessus et les
  runs qualifiants rejoués (section « Après #70 »).
- LC04 reste synthétique (lignes DPGF mappées semées en SQL) ; aucun classeur OPTIMA réel n'est encore importé par ce
  parcours.
- La migration doit rester la plus récente au moment de la fusion : la restampiller si `main` en reçoit une autre.
