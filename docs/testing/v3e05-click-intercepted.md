# V3E05 : « + » de section intercepté après l'annulation d'une suppression v3

Parcours concerné : `e2e/army/local/engine-v3-editor-actions.e2e.ts`, V3E05
(sous-lot 2.6 : une ligne v3, une ligne ajoutée et une section supprimées, une
suppression annulée).

## Échec observé

[PR #42](https://github.com/maxlemeur/HEX_BC/pull/42), run CI
[`39107622137`](https://github.com/maxlemeur/HEX_BC/actions/runs/39107622137)
(suite critical, 2 workers, commit de fusion `4fd38d80`, Chromium 156 headless,
1280×800) : 94/95, V3E05 seul rouge.

```text
tap did not become actionable in time: locator.click: Timeout 29727ms exceeded.
<div class="estimate-cell__content">…</div> intercepts pointer events:
getByRole("button", name: "Ajouter dans <lot>")  (engine-v3-editor-support.ts:264)
```

Étapes du rapport : annulation de la suppression de la ligne C à 07:38:04.844,
lecture en base de la ligne recréée, survol du titre de la section à
07:38:07.165 (134 ms), puis le tap sur « + », échoué après 29,8 s. L'écran à
l'échec montre la ligne C recréée, des totaux justes (460,00 €), « Annuler »
désactivé, « Rétablir » actif et un état de synchronisation « En attente »
30 s après l'annulation.

## Défaillances envisagées

| Hypothèse | Verdict | Preuve |
| --- | --- | --- |
| Chevauchement fixe à 1280×800 (une cellule recouvre le « + ») | écartée | au repos, `elementFromPoint` au centre du « + » (x 420, y 382, 26×26) rend le bouton |
| Éditeur de cellule resté ouvert (`estimate-cell--editing` masque le « + ») | écartée | classes de la cellule de section sans `--editing` ; focus sur la cellule PR FO de B |
| En-tête ou ruban collant au-dessus de la ligne | écartée | l'intercepteur est l'enveloppe de la cellule de section elle-même ; page de 800 px pour 800 px, `scrollY` 0 |
| Virtualisation ou remontage de la ligne | écartée | Chromium rend `:hover` à un nœud remonté sous un pointeur immobile ; le clic passe (expérience isolée) |
| Course focus/défilement | écartée | aucun événement `scroll` relevé de l'annulation au tap |
| Décalage transitoire de la grille sous un pointeur immobile | **cause** | voir ci-dessous |

Un échantillonneur par image (diagnostic, jamais commité) a relevé, à chaque
annulation, la ligne de section à y 380 → 466 → 380 pendant 130 à 150 ms, et
dans la zone d'alertes du ruban
`estimate-editor-alert-totals-out-of-sync` : « Les totaux n'ont pas pu être
sauvegardés. Vos modifications locales sont conservées. Réessayer » : un bloc
de 62 px qui, avec ses marges, pousse la grille de 86 px. Puis « En attente »
reste affiché (8 s et plus en local, 30 s dans la CI), au plus jusqu'à
l'autosauvegarde différée de 60 s.

## Mécanisme

1. L'annulation d'une suppression (`useEstimateEditorItemsController`,
   commande `delete-item`) recrée la ligne (`POST /items`), remet ses voisines
   en ordre (`POST /items/reorder`), puis seulement remet l'alerte à faux.
2. `POST /items` est acquitté sans totaux : `onCommit`
   (`useEstimateEditorSyncController`) calculait
   `needsTotalsSave = !totals || …`, vrai, et levait `totalsOutOfSync` et
   `hasPendingTotalsSave`. L'alerte s'affiche au-dessus de la grille pendant
   toute la remise en ordre.
3. En v3 c'est faux : l'éditeur n'a aucun total client (`persistedTotals` nul)
   et le serveur stocke les six totaux v3 dans la même transaction que la ligne
   (`persistAtomicEstimateV3Item`, `atomic_create_estimate_item`,
   `p_version_patch`). Seule l'autosauvegarde différée
   (`AUTOSAVE_DEBOUNCE_MS`, 60 s) vide ensuite `hasPendingTotalsSave` : son
   flush passe le garde « rien à faire » grâce à ce drapeau, n'envoie aucune
   requête (aucun total v3 côté client, `buildVersionTotalsPatch(null)` vide),
   remet le drapeau à faux et affiche « Sauvegardé ». « En attente » dure donc
   jusqu'à 60 s sans rien à enregistrer ; ce n'est pas un état permanent.
4. Le « + » n'accepte le pointeur que si la cellule de désignation est
   `:hover` ou `:focus-within` (`estimate-frozen.css`,
   `.estimate-section-quick-actions`). Le clic de Playwright 1.64 vérifie la
   cible au point visé **avant** de déplacer la souris
   (`setupHitTargetInterceptor` → `expectHitTarget`). Survol pendant le décalage,
   puis la grille remonte de 86 px : le pointeur reste sur la ligne B, la
   cellule de section n'est plus survolée, le point visé tombe sur
   `estimate-cell__content`, et les reprises ne bougent jamais la souris.

Un utilisateur réel n'est pas bloqué : un mouvement du pointeur (ou le focus
clavier) fait réapparaître le « + ». Il voit en revanche une fausse alerte
d'échec et la grille sauter deux fois de 86 px à chaque annulation de
suppression ; un clic pendant le saut tombe sur une autre ligne. L'état reste
ensuite « En attente » jusqu'à l'autosauvegarde de 60 s, qui n'envoie rien puis
affiche « Sauvegardé ».

## Rouge

- Reproduction exacte de la CI (temporaire, non commitée) : la requête de
  remise en ordre est retenue, le titre de section survolé pendant
  l'annulation, la requête libérée, puis le tap sur « + ». Même message que la
  CI, 2 fois sur 2 (itérations dev-loop 007 et 008, `origin/main` 5cfd4a94) :
  `alertWhileUndoInFlight: true`, ligne à 466 au lieu de 380.
- Régression commitée (`229a51da`), sur le produit non corrigé, 2 fois sur 2
  (itérations 009 et 010) :
  `expected {"inFlight":{"alert":true,"top":466},"settled":{"alert":false,"top":380,"status":"En attente"}}`
  `to equal {"inFlight":{"alert":false,"top":380},"settled":{"alert":false,"top":380,"status":"À jour"}}`.

V3E05 retient désormais la remise en ordre de l'annulation (route du test, puis
`fallback` vers le garde réseau) pour garder ouverte la fenêtre que la CI a
touchée au hasard. Il attend la ligne C rendue (création acquittée, seule la
remise en ordre en vol), exige ni alerte ni déplacement de la section, survole
le titre, libère la requête, attend « Rétablir » actif (fin de l'annulation),
exige toujours ni alerte ni déplacement et l'état « À jour », puis tape le « + »
sans nouveau survol, comme la CI.

## Correction

`writesEditorTotals` (`src/lib/estimates/editor-engine.ts`, aiguillage
exhaustif) : vrai en v1/v2, faux en v3. Dans `onCommit`, une écriture de
structure sans totaux n'exige un réenregistrement du pied que si l'éditeur
écrit des totaux. Les v1/v2 gardent exactement leur expression ; une v3 reste en
attente seulement pour des saisies de ligne ou un paramétrage en attente, comme
avant. Aucune migration, aucune route, aucun changement OpenAPI.

## Preuves avant fusion

Checkout Linux `~/miaouffrage-v3e05` (WSL Ubuntu 24.04, Node 24.19.0), pile
native possédée, preuves sous `.e2e/army/ci/` de ce checkout.

- Boucle dev-loop (`npm run e2e:army:dev-loop -- run --grep V3E05`), commit
  `d48aed27`, `dirty: false`, build `JGUa4goJzA4_rf_E0uyvf` : 10 itérations
  consécutives vertes sur 10 (013 à 022, 2/2 chacune, 13 à 20 s), à chaque fois
  `{"inFlight":{"alert":false,"top":380},"settled":{"alert":false,"top":380,"status":"À jour"}}`.
  Session `.e2e/army/ci/2026-10-18T09-09-39-966Z-dev-loop`.
- Parcours v3 dans la boucle (`--grep "V3E|V3P01|V3FC"`, itération 012, même
  contenu avant commit) : 17/17.
- Qualification `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E|V3P01|V3FC" --app-port 3177`,
  commit `d48aed27`, `dirty: false`, pile neuve (migrations, pgTAP, matrice RLS, build) : 17/17 (16 parcours
  v3 et le setup de connexion), 0 échec, 0 reprise, 0 skip, 5 min 55 s ; preuves
  `.e2e/army/ci/2026-10-18T09-50-25-339Z-critical`.
- `npm run typecheck`, `npx eslint` des trois fichiers touchés, `npm test --
  src/hooks/useEstimateEditorSyncController.test.ts` (35/35) et `git diff --check 5cfd4a94 HEAD` : verts
  (aucun test unitaire ajouté : la régression E2E couvre le défaut).

## Preuves sur la tête fusionnée

`origin/main` `80d90011` fusionnée par `c2330507`, puis `28db9172` (commentaire
de `writesEditorTotals` seul). Même checkout, piles natives possédées, jamais le
Supabase partagé. Chaque preuve : commit `28db9172`, diff vide (`e3b0c442…`).
Après `28db9172`, seuls ce dossier et la fusion d'`origin/main` `d4b6ff73`
(`AGENTS.md` seul, hors des entrées du build) changent.

| Contrôle | Commande | Résultat | Preuve |
| --- | --- | --- | --- |
| Boucle V3E05 | `npm run e2e:army:dev-loop -- start --app-port 3177`, 6 × `run --grep V3E05`, `stop` | 6/6 vertes (2/2 chacune, 15 à 63 s, build `v2_hABo10gm7deM6LJ187` reconstruit à la 1re), chaque fois `{"topBeforeUndo":380,"inFlight":{"alert":false,"top":380},"settled":{"alert":false,"top":380,"status":"À jour"}}` ; `stop` : pile détruite, ports fermés | `.e2e/army/ci/2026-10-18T10-19-56-939Z-dev-loop` |
| Qualification v3 | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep "V3E\|V3P01\|V3FC" --app-port 3177` | pile neuve (migrations, pgTAP, matrice RLS, build) : 17 sélectionnés sur 103, 17 verts, 0 échec, 0 instable, 0 skip, 5 min 03 s ; V3E05 au même `actual` | `.e2e/army/ci/2026-10-18T10-25-50-450Z-critical` |
| Types | `npm run typecheck` | exit 0 | `~/v3e05-logs/typecheck-merged.log` |
| Vitest | `npx vitest run --project=jsdom src/hooks/useEstimateEditorSyncController.test.ts` | 35/35 | `~/v3e05-logs/vitest-merged.log` |
| Lint, espaces | `npx eslint` des trois fichiers de code ; `git diff --check 80d90011 HEAD` | exit 0 ; propre | `~/v3e05-logs/eslint-merged.log` |

`npm run verify:pr` n'a pas été lancé localement : la CI de la PR le couvre.

## Limites

- v1/v2 inchangés : leur annulation de suppression passe par le même
  `POST /items` sans totaux ; elle afficherait la même alerte le temps de la
  remise en ordre (en v2 le pied est bien à réenregistrer, mais l'alerte parle
  d'un échec). Non reproduit, non modifié.
- En v3, une écriture de structure avec des saisies de ligne en attente, ou
  concurrente d'une sauvegarde (`structureChanged` du flush), lève encore
  l'alerte : un état en attente affiché comme un échec. Non reproduit.
- Le survol puis le tap d'`addGridLine` restent sensibles à tout décalage de la
  grille entre les deux actions ; la régression ne tient ouverte que la fenêtre
  de la cause connue.
- Branche partie d'`origin/main` 5cfd4a94, fusionnée avec `origin/main`
  `80d90011` (`c2330507`) ; entre les deux, `origin/main` n'avait touché aucun
  des quatre fichiers de la branche.
- Zone partagée (AGENTS.md, au plus une PR ouverte par zone) : la PR #41 touche
  aussi `src/hooks/*EstimateEditor*` et `e2e/army/local/engine-v3-*`, d'où une
  ouverture et une fusion de cette PR après la sienne. La PR #45 touche les mêmes
  zones. `git merge-tree` : aucun conflit avec #41 ; avec #45, seuls les conflits
  qu'elle a déjà avec `origin/main` (dont `DETAIL_ACTIONS_REASON`), à l'identique.

## Revue

- Tour 1, revue locale de l'auteur : aucun défaut bloquant ; un point mineur
  laissé tel quel pour garder les preuves sur des entrées identiques (la route
  retenue de la remise en ordre n'est retirée que sur le chemin de succès).
- Tour 2, revue indépendante en lecture seule (18/10/2026) : prête, ni bloquant
  ni majeur ; cause, correction, rouge et preuves vérifiés contre le code et les
  empreintes des itérations. Trois points mineurs, corrigés : « En attente »
  durait jusqu'à l'autosauvegarde de 60 s et non indéfiniment (dossier et
  commentaire de `writesEditorTotals`) ; un décompte de
  commits d'avance périmé ; la description de PR sans tableau de validation, sans
  lien vers la PR #42 et le run CI, ni ordre de fusion après la PR #41 (même
  zone partagée des hooks de l'éditeur et des parcours engine-v3).
