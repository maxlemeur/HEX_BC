# V3E01 : rôle de main-d'œuvre perdu pendant la saisie dans la grille

Parcours concerné : `V3E01` (`e2e/army/local/engine-v3-editor.e2e.ts`), saisie des sept lignes-oracle par la
grille de l'éditeur v3. Branche `fix/v3e01-labour-role-lost`, base `origin/main` `78533fe5`. Ce document
remplace la puce « Instabilité observée, non reproduite » de
[estimate-engine-v3-2.6.md §8.5](estimate-engine-v3-2.6.md#85-limites).

## Défaut

Environ un passage de `V3E01` sur trois échouait sur une ligne au hasard (O1, O2, O4 et O6 observés). Le
rôle « Tuyauteur » rempli dans « Rôle de main-d'œuvre pour {ligne} » n'était jamais enregistré, et
`waitForAutoSave` échouait (« expected false to be true »). Le rôle n'est pas perdu par une sauvegarde : il
n'est jamais écrit. La grille retirait le focus de la liste juste après que celle-ci l'avait reçu, et la liste
vidait ensuite le texte saisi.

Enchaînement établi par sonde sur `78533fe5` :

1. Tab depuis « h MO / u » : le champ des heures perd le focus et enregistre sa valeur.
   `useSpreadsheetNavigation` place la cellule active sur `labor_role`, `editingCellId` vaut `null`, et son
   effet donne le focus à la cellule (`div` `gridcell`).
2. La modification des heures change `items`. `useDeferredValue(items)`
   (`src/hooks/useEstimateEditorState.impl.tsx:1147`) planifie un rendu de fond : `qualityItems`, puis les
   indicateurs qualité, puis `visibleLineIds` (`src/components/estimates/hooks/useEstimateVisibility.ts:143`),
   puis `spreadsheetNavigationRows` (`EstimateEditorTable.tsx:1974`), puis un nouveau modèle de navigation. Ce
   modèle relance l'effet de focus de `useSpreadsheetNavigation.ts` (l. 434-492 avant correction), dont la
   fermeture garde `editingCellId = null`.
3. Le `fill` de Playwright donne le focus à la liste. Il arrive que ce soit avant que React ait exécuté les
   effets passifs de ce rendu de fond. React les exécute alors au début du rendu synchrone de l'événement
   `focus`. L'effet périmé tourne pendant que `document.activeElement` est la liste. Sa garde n'épargnait qu'un
   éditeur **hors** de la cellule active : un éditeur dans la cellule active était traité comme « pas en
   édition », et `cellElement.focus()` lui prenait le focus. La liste se fermait (`onBlur`).
4. Chrome insère quand même « Tuyauteur » dans le champ, puis le focus y revient. `onFocus` de
   `EstimateTypeCombobox` remet la recherche à vide (`setSearch({ text: "", base: value })`).
5. Au Tab, la recherche est vide : aucune suggestion, pas de message « Type inchangé », rien n'est validé.
   Ctrl+S envoie la ligne avec `labor_role_id` à `null`.

## Défaillances observables

1. Un rôle saisi dans la grille n'est pas enregistré, sans message : la ligne garde un PU sans main-d'œuvre
   (CI du 18/10, run `39107255705` de la PR #41 : O4 enregistrée avec Q 1139, PR 302, net 447 627 c =
   1139 × 3,93 €).
2. Le focus quitte l'éditeur qu'on vient d'ouvrir : la liste se ferme, et l'utilisateur qui tape touche par
   touche repasse par « remplacer et éditer », au risque de perdre le premier caractère.
3. À ne pas introduire : un clic dans le champ en lecture seule d'une cellule non éditable (PU de vente) doit
   toujours rendre le focus à la cellule, sinon flèches et Tab ne naviguent plus dans la grille
   (`toCellKeyDownHandler` ignore les touches qui ne visent pas la cellule).

## Preuves du diagnostic (18/10/2026)

WSL Ubuntu 24.04, Node 24.14.0, `e2e` 0.21.0 / `playwright-core` 1.64.0, workers=1, clone `~/miaouffrage-v3e01`
à `78533fe5`. Une boucle `npm run e2e:army:dev-loop -- run --grep V3E01` possédée
(`.e2e/army/ci/2026-10-18T07-47-40-263Z-dev-loop/`, port 3157), arrêtée depuis.

| Lot | Diff local (`diffSha256`) | Itérations | Résultat |
| --- | --- | --- | --- |
| A, référence | `e3b0c442…b855` (vide) | 001-004 | 1 échec sur 4 (001, O2 : liste vide, focus sur le prix) |
| B, sondes | `31a6cf9c…6bc919a6a96` | 005-012 | 3 échecs sur 8 (005 O4, 010 O6, 012 O1) |
| C, sondes et essai de correction | `7cdb71ac…bcef5788` | 013-022 | 10 sur 10, 70 lignes ; course survenue deux fois (016 O5, 018 O1), neutralisée |

Sans correction, 4 itérations sur 12 échouent. Dans les itérations sondées en échec, la séquence est
toujours la même : `cbx:focus` sur la liste, puis 0,2 à 0,3 ms plus tard `nav:focus-cell`
(`editingCellId: null`, de `input[Rôle de main-d'œuvre pour Ox]` vers la cellule `labor_role`), `cbx:blur`,
saisie de « Tuyauteur », retour du focus, `cbx:search {text: ""}`, Tab sans suggestion, puis
`flush:start [{role: null}]`. Les 43 lignes passées sans correction ne montrent aucun vol de focus, les trois
lignes en échec en montrent exactement un. Dans les deux courses de l'essai C, `nav:effect`
(`editingCellId: null`, focus sur la liste, `modelChanged: true`) suit immédiatement `cbx:focus` et précède
`items:deferred-commit` : c'est bien le rendu différé qui exécute l'effet périmé.

Écartés par la sonde : options de rôle absentes (10 chargées, dont « Tuyauteur »), coalescence ou écrasement
de la sauvegarde (aucun rechargement, la ligne part déjà sans rôle), conflit de `content_revision` (toutes
les écritures validées), instantané `itemsRef` périmé (il ne touche que `h_mo_per_unit`), deux suggestions
possibles (une seule avec le texte saisi).

Copies des preuves (avec SHA-256), dans le répertoire temporaire de la session de diagnostic
(`…/scratchpad/v3e01-diag/`), hors dépôt :

| Fichier | SHA-256 |
| --- | --- |
| `it005-…-v3e01-probe-o4-failed.json` | `3eb034a29b9d1aeeddf7415c01a57ba3095ebf4fa52942663159417cc4d3f813` |
| `it010-…-v3e01-probe-o6-failed.json` | `6aafed3d84104e94c849bbe92dfb4b6b2b248d51a7ea34d95aa0693f6e2f2423` |
| `it012-…-v3e01-probe-o1-failed.json` | `050733d102b37c4821f9632d8c674bd9d9631e5314639b29f552ee6751488263` |
| `it016-…-v3e01-probe-o5-passed.json` (course neutralisée) | `63563f9741bc47d5446497690b20b5c966dbd590c5b926071843074de10a9f92` |
| `it018-…-v3e01-probe-o1-passed.json` (course neutralisée) | `250f20f6c3e0af104a36658848e49f2efe11c3981147820d45c7c9af9ee05c58` |
| `v3e01-probe-1.diff` (lot B) | `31a6cf9c9d870f61c131cf83aa60b9abcf2c02e2f9a4cda5c5e6e6bc919a6a96` |
| `v3e01-probe2-fixtrial.diff` (lot C) | `7cdb71ac25e826ea0acd6ad55a800ca4391119fada35ed4af8c9280bfcef5788` |

## Rouge

### Pourquoi une régression isolée (exception AGENTS.md)

La défaillance dépend d'un ordre que le navigateur ne laisse pas choisir : React exécute les effets passifs
du rendu différé soit avant l'événement `focus` de la liste (passage vert), soit au début de son rendu
synchrone (rouge). Un parcours ne peut ni retarder ce rendu ni placer le focus entre sa validation et ses
effets sans dépendre de l'ordonnanceur interne de React ; ralentir le processeur ou grossir le devis élargit la
fenêtre sans la rendre certaine. `V3E01` reste la régression E2E, probabiliste (rouge environ une fois sur
trois sur `78533fe5`). Le rouge déterministe est donc un test du hook, à côté du module.

### Test

`src/hooks/useSpreadsheetNavigation.test.ts`, « keeps focus on the active cell's editor when a pending render
rebuilds the rows (V3E01) » (commit `0d434089`). Le harnais rend une cellule `labor_role` dont l'éditeur est
enregistré par `getEditorProps().ref` mais ne signale pas son focus : c'est l'état figé de l'étape 3, focus
dans l'éditeur, `editingCellId` encore à `null`. Le test attend le focus sur la cellule, le donne à l'éditeur,
puis rend les mêmes lignes dans un nouveau tableau, comme le rendu qualité différé, et exige que l'éditeur
garde le focus.

Rouge sur `0d434089` (produit inchangé, diff vide, Node 24.19.0) :
`npx vitest run --project=jsdom src/hooks/useSpreadsheetNavigation.test.ts` → sortie 1, 1 échec sur 10 :
focus attendu sur `input[data-testid=editor-row-1]`, reçu sur la cellule `row-1::labor_role`. Journal
`~/v3e01-fix/red-vitest.log` du clone WSL, SHA-256
`56cea1bb789a8b2f353efefcfd2f7e0be15117fbe77fded109c94bd902b1f1fe`.

## Correction

`useSpreadsheetNavigation.ts`, effet de focus (commit `989d8372`) : quand l'éditeur enregistré de la cellule
active a le focus (`editorElementsRef.current.get(activeCellId) === document.activeElement`), l'effet le lui
laisse. L'effet lit le focus réel, plus seulement `editingCellId` de sa fermeture. Un éditeur hors de la cellule
active était déjà épargné. Un élément non enregistré dans une cellule, comme le champ en lecture seule du PU
de vente (cellule non éditable, jamais enregistrée), rend toujours le focus à la cellule (défaillance 3).

Variantes écartées :

- Retirer `!cellElement.contains(activeElement)` (essai C du diagnostic) : épargne aussi tout champ non
  enregistré dans la cellule active. Un clic dans le PU de vente laisserait le focus dans son champ en lecture
  seule et couperait la navigation au clavier (défaillance 3).
- Garder la recherche de `EstimateTypeCombobox` au retour du focus : `onBlur` la ferme toujours, donc un
  retour de focus ordinaire (fenêtre, clic) n'a rien à garder ; ce changement ne servirait qu'après un vol de
  focus et le masquerait.
- Ne plus reconstruire le modèle de navigation au rendu qualité différé : réduit l'exposition sans retirer la
  cause, puisque tout autre rendu qui change les lignes rouvrirait la même fenêtre.

Ni le parcours ni ses attentes ne changent : aucune reprise, aucune attente, aucun délai ajoutés.

## Preuves au vert

Même environnement que le diagnostic : WSL Ubuntu 24.04, Node 24.19.0, `e2e` 0.21.0 (`playwright-core` 1.64.0
de `@e2e-dev/web`), clone `~/miaouffrage-v3e01` remis à la branche par `git reset --hard`, diff local vide
(`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`), aucun fichier non suivi. Journaux sous
`~/v3e01-fix/` du clone, non versionnés (en-tête : révision, empreinte du diff, version de Node).

### Régression isolée et contrôles

| Contrôle | Révision | Résultat | Journal (SHA-256) |
| --- | --- | --- | --- |
| Rouge : `npx vitest run --project=jsdom src/hooks/useSpreadsheetNavigation.test.ts` | `0d434089` | sortie 1, 1 échec / 10 (focus sur la cellule) | `red-vitest.log` `56cea1bb…f1fe` |
| Vert : même commande | `989d8372` | sortie 0, 10 / 10 | `green-vitest.log` `38d21e65…8730` |
| `npx vitest run src/hooks/useSpreadsheetNavigation.test.ts src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts` | `989d8372` | sortie 0, 3 fichiers, 33 / 33 | `touched-vitest.log` `ca43f40a…0f8d` |
| `npx vitest run --project=jsdom src/components/estimates src/hooks` | `989d8372` | sortie 0, 76 fichiers, 495 / 495 | `jsdom-estimates-hooks.log` `d10b2c26…af51` |
| `npx eslint --max-warnings=0` sur les deux fichiers touchés | `989d8372` | sortie 0 | `eslint.log` `10a6bf9e…9893` |
| `npm run typecheck` | `989d8372` | sortie 0 | `typecheck.log` `1c53efb1…8f9c` |

### Stabilité : boucle `V3E01`, 20 itérations consécutives

```sh
npm run e2e:army:dev-loop -- start --app-port 3166 --ttl-minutes 180
npm run e2e:army:dev-loop -- run --grep V3E01   # 20 fois, l'une après l'autre
npm run e2e:army:dev-loop -- stop
```

Boucle possédée `miaouffrage-ci-2797-520efd89`, build `Wzp6BSIu4wwy4wSAny5pU` construit une fois sur `989d8372`
(migrations, pgTAP et matrice RLS passés au démarrage), preuves
`.e2e/army/ci/2026-10-18T08-47-30-270Z-dev-loop/` (manifeste de la boucle
`ab52cb63e0ad65c85293a8c19a3a10cb820e78af034beaa34b15fd5aec7857b8`). Workers=1, comme les lots A à C.

- 20 itérations sur 20 vertes (001 à 020, 08:49 à 09:17 UTC), aucune reconstruction, aucun échec, aucune
  reprise : chacune exécute le setup de connexion et `V3E01` (2 / 2).
- Les 140 lignes saisies par la grille (7 par itération) sont relues de l'API avec le rôle attendu
  (`v3e-grid-o1` à `o7` : `actual.roleId` = `expected.roleId`), en plus de l'attente exacte du parcours.
- Durée des parcours : 66,3 à 77,5 s, deux itérations à 193 s et 199 s (machine partagée), comme les
  passages verts de référence (66 à 67 s).
- Comparaison : sur `78533fe5`, 4 itérations sur 12 échouaient (lots A et B). Avec ce taux, 20 succès de suite
  auraient une probabilité de (2/3)^20 ≈ 0,03 %.
- Résumé par itération (statut, révision, diff, SHA-256 du manifeste, rôle des 7 lignes) :
  `~/v3e01-fix/iterations-summary.txt`, SHA-256
  `b0a08d117b0f47b6ffa2bb2a6328b69795ccbd493caac644cf99b65702c41905`. Arrêt : pile détruite par le
  superviseur, entrée du registre retirée, ports fermés, état retiré (`loop-stop.log` `67f09346…363e`).

### Runs `critical` (pile possédée neuve, build de production)

Chaque run recrée sa pile, rejoue migrations (« Local migration inventory matches the repository. »), pgTAP
(`Files=20, Tests=1854, Result: PASS`) et matrice RLS (« Behavioral RLS matrix passed. »), crée un compte ARMY
neuf, construit puis exécute les 26 tests retenus sur 95 (setup de connexion compris), une tentative chacun ;
confidentialité `passed` partout. Révision `989d8372`, diff vide.

```sh
E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep 'V3E|V3P01|V3FC|numeric entry|bulk edit sync' --app-port 3166
```

| Run | Workers | Résultat | Preuves (manifeste SHA-256) |
| --- | --- | --- | --- |
| Q1, qualifiant demandé | 2 | sortie 1 ; 25 / 26 ; **`numeric entry v3` rouge** (« element is outside of the viewport: getByTestId("estimate-editor-settings-button") ») ; `V3E01` vert, 7 lignes au rôle attendu | `.e2e/army/ci/2026-10-18T09-18-56-757Z-critical`, `afb4c7e4d462a5d319656d023f06e764ff989d9880b58d4daf97db48016e51fa` |
| Q2, même commande | 2 | sortie 1 ; 24 / 26 ; **`numeric entry v3` rouge** (même cause) ; **`V3E03` rouge** (`PATCH …/lock?force=true` 409, voir Limites) ; `V3E01` vert | `.e2e/army/ci/2026-10-18T09-27-44-038Z-critical`, `076bdb0a84a0dad917fbcea098746d3a96a19cf80a7930d1facfbc8f1cf3d90a` |
| Q3, même sélection | 1 | sortie 0 ; **26 / 26** (`V3E01` 68,8 s, 7 lignes au rôle attendu ; `numeric entry v3` 16,8 s ; `V3E03` 15,0 s), 7 min 9 s de parcours | `.e2e/army/ci/2026-10-18T09-40-34-349Z-critical`, `65ca3e4bbe0d7d1426c808088416e6cf1511d527d69fbbd67e9372b973e57cdc` |

Les rouges de Q1 et Q2 restent des échecs ; leur cause n'est pas le chemin corrigé :

- `numeric entry v3` : collision connue entre deux parcours v2 à deux workers, décrite au §11.5 de
  [estimate-engine-v3-2.6.md](estimate-engine-v3-2.6.md) et vue le 18/10 avant cette branche
  (`2026-10-18T01-49-07-316Z-critical`). `bulk-edit-sync-sources` passe l'utilisateur ARMY partagé en mode Expert
  pendant ses scénarios ; `numeric entry v3`, qui suppose le mode Simplifié, a démarré pendant le troisième
  (Q1 : 09:20:44 contre 09:20:43 à 09:20:55 ; Q2 : 09:30:04 contre 09:30:02 à 09:30:14). Les deux écrans à
  l'échec montrent les pastilles du mode Expert (« Résumé du paramétrage », « Marge : 0% », « TVA : 20% ») et le
  bouton des réglages hors de la fenêtre. À un worker (Q3), il passe.
- `V3E03` (Q2) : seul parcours en cours (l'autre worker était inactif depuis 09:32:10). La reprise forcée du
  verrou par le parcours (`releaseOfferForPreselection`) a reçu 409 ; le journal serveur porte
  `23505 duplicate key value violates unique constraint "draft_locks_version_id_key"` sur cette version, loggé
  par `mapSupabaseError` du chemin `takeover_estimate_draft_lock`. Aucun lien avec le focus de la grille.

`npm run verify:pr` (WSL, même révision, diff vide) : sortie 0 en 2 min 25 s ; 763 signatures vérifiées,
« Architecture budgets passed (1134 modules, 0 allowed runtime cycles). », « OpenAPI spec valide et
synchronisee. », `typecheck`, `lint` (`--max-warnings=0`), Vitest node 298 fichiers / 2 838 tests (1 fichier et
2 tests ignorés), jsdom 164 / 824, couverture critique 3 / 12. Journal `verify-pr.log`, SHA-256
`4dc412ffa11d7a785b42220385b8d194e1acc75bcd050531d7cb9218254afd06`.

Carte d'impact (inchangée) : `node scripts/tester-army/select-journeys.ts --event pull_request --base 78533fe5
--head HEAD` retient 22 fichiers sur 27 : le setup de connexion et les 21 parcours de la fermeture d'impact de
`useSpreadsheetNavigation.ts`, dont `engine-v3-editor.e2e.ts`, `numeric-entry-v3.e2e.ts` et
`bulk-edit-sync-sources.e2e.ts` ; le test du hook est classé hors exécution.

## Limites

- L'échec de la CI (run `39107255705`, O4) n'était pas sondé ; il est rattaché par son symptôme identique
  (liste vide, pas de « Type inchangé », autres champs enregistrés, focus sur le prix au Ctrl+S).
- L'effet sur un utilisateur réel est déduit du code, pas observé. Avec une saisie touche par touche, le
  symptôme attendu est visible (liste fermée, premier caractère peut-être perdu). La perte silencieuse du rôle
  entier exige un texte inséré pendant que la cellule a le focus puis un retour du focus, ce que fait
  `insertText` de Playwright ; collage, IME ou saisie automatique pourraient le faire, non vérifié.
- Les itérations de la boucle n'étaient pas sondées : elles prouvent l'absence d'échec, pas le nombre de
  courses neutralisées. Les sondes de l'essai C ont montré l'état visé (focus sur la liste, `editingCellId` à
  `null`) ; la correction sort de l'effet dans ce même état, en n'épargnant que l'éditeur enregistré de la
  cellule active.
- Le run qualifiant demandé (Q1, deux workers) n'est pas vert, ni sa reprise Q2 : la sélection associe
  `numeric entry v3` et `bulk-edit-sync-sources`, dont la collision de mode est connue et indépendante de ce
  correctif. Seule la même sélection à un worker (Q3) est verte. La CI d'une pull request retient ces deux
  fichiers et tourne à deux workers : elle peut rougir pour la même raison.
- Défaut préexistant, hors périmètre (Q2, `V3E03`) : `takeover_estimate_draft_lock`
  (`supabase/migrations/20260820194939_atomic_estimate_draft_lock_takeover.sql`) sérialise les reprises forcées
  par un verrou consultatif, mais pas l'acquisition ordinaire (`acquireLock`, `INSERT` simple, relancée toutes
  les 5 s par la page qui ne détient pas le verrou). Si cette insertion est validée entre le `DELETE` et
  l'`INSERT` de la reprise, la reprise échoue en `23505`, renvoyé en 409. Vu une fois, non reproduit, rien
  ajouté pour le contourner.
- Hors périmètre, non causal : `patchItem` lit `itemsRef`, mis à jour dans un effet passif
  (`patch:stale-snapshot` à chaque sortie d'un `DecimalDraftInput`). Sans effet aujourd'hui (les deux appels
  écrivent le même champ), il le deviendrait avec des charges complètes de ligne.
- Hors périmètre : la liste de nature de ligne (`EstimateLineNatureSelect`, dans la cellule de désignation)
  arrête la propagation de son focus et n'est pas enregistrée comme éditeur. La correction ne la couvre pas :
  si l'effet repasse pendant qu'elle a le focus dans la cellule active, elle le perd comme avant. Non observé
  dans un parcours.
