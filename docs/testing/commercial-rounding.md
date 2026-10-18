# CORE-01 — arrondi commercial au palier inférieur

## Défaillances et scénarios définis avant l'implémentation

| Défaillance observable | Scénario et oracle indépendant |
| --- | --- |
| Le wizard ou le paramétrage choisit l'arrondi au plus proche et augmente le montant | Nouvelle version EUR, marge 1, TVA 20 %, une ligne de 760,63 € HT : TVA 152,13 €, TTC calculé 912,76 €. Pas de 1 € : `down`, TTC à payer 912,00 €, ajustement −0,76 €. |
| Le choix affiché ne correspond pas au réglage sauvegardé | Modifier le pas, enregistrer, relire l'API puis recharger : mode et pas inchangés. |
| Le pas n'est pas appliqué, ou l'arrondi est cumulatif | Même 912,76 € : pas 10 € → 910 €, pas 50 € → 900 €, pas 100 € → 900 €. Désactiver → 912,76 €. Le HT et la TVA comptable affichée restent 760,63 € et 152,13 €. |
| Un montant exact perd un palier | Une ligne de 760,83 € HT : TVA 152,17 €, TTC 913,00 €. Pas 1 € → 913,00 €. |
| L'export ou l'impression confond la TVA et l'ajustement commercial | XLSX et impression : HT 760,63 €, TVA 152,13 €, TTC calculé 912,76 €, ajustement −0,76 €, montant à payer 912 €. DPGF : HT/quantité/unité inchangés ; ce format ne porte pas le pied commercial TTC. |
| Un ancien réglage est affiché « Aucun » ou converti sans choix explicite | Nouveaux brouillons ARMY préparés avec anciens modes `nearest` et `up`, ainsi qu'un pas `down` atypique de 2,50 €. Libellé historique explicite ; modifier seulement le titre puis enregistrer conserve mode, pas et totaux. |

Le moteur, ses arrondis comptables et les snapshots historiques ne sont pas
modifiés. Le plancher existant qui interdit un TTC inférieur au HT, et le
court-circuit de l'arrondi en autoliquidation, restent applicables. Il ne faut
donc pas présenter l'option comme une réduction garantie pour tout régime.
Le contrat de stockage historique `total_tax_cents` inclut l'ajustement
commercial ; il n'est pas l'oracle de TVA comptable. Les sorties XLSX et
d'impression sont contrôlées séparément sur leur TVA et leur ajustement.

## Périmètre de preuve

Le scénario TesterArmy `commercial rounding` utilise le login normal et crée
seulement ses propres brouillons ARMY. Les réglages passent par les vraies
interfaces ; les lectures API et les cellules des fichiers téléchargés servent
d'oracles. Les fixtures et JSON conservent les montants, versions et réglages ;
les classeurs sont conservés avec SHA-256. Le manifeste du wrapper conserve la
commande, la révision, les modifications locales et l'environnement.
Un runner isolé peut indiquer son répertoire de téléchargements par
`E2E_ARMY_ARTIFACT_ROOT` ; le défaut est `.e2e/army/critical/artifacts`.

```powershell
npm run e2e:army:critical -- --grep "commercial rounding"
```

Aucune fixture de catalogue, aucun modèle et aucun abonnement agent ne sont
nécessaires. L'environnement connecté et le compte doivent être autorisés par
le responsable de l'exécution. Les traces authentifiées restent désactivées.

Les campagnes critiques interdisent l'envoi et les mutations de statut. Ces
scénarios ne créent donc pas d'offre émise. Leur non-réécriture est à qualifier
séparément sur une fixture locale émise ; les tests existants de snapshots et
de calcul restent une preuve spécialisée, pas une exécution E2E de cet état.

La recette locale finale du 11 octobre 2026 est réussie ; ses preuves et ses
limites sont consignées ci-dessous. Les échecs intermédiaires restent conservés.

## Diagnostic de la première recette locale

L'archive `.e2e/product-foundation/runs/2026-10-11T02-52-53-541Z/`
montre un succès du parcours historique et un échec du premier oracle de pied
sur la création. La préparation par `createLineViaApi` avait inséré directement
la ligne à 760,63 € sans action de sauvegarde de l'éditeur. Cette API calcule
les montants de la ligne, puis renvoie le jeton de version ; elle ne recalcule
pas le pied sauvegardé. Celui-ci était encore à zéro, alors que l'interface
capturée affichait correctement 760,63 € HT, 152,13 € de TVA, 912,76 € calculés
et 912,00 € à payer.

Le scénario prépare désormais une ligne neutre, effectue la saisie dans la
grille puis une sauvegarde explicite par Ctrl/Cmd+S avant de vérifier le pied
persisté. L'oracle et son délai sont inchangés ; ce correctif de fixture ne
transforme pas l'exécution échouée en succès. Un replay était nécessaire.

Le replay `.e2e/product-foundation/runs/2026-10-11T02-57-32-665Z/`
passe la création, la sauvegarde, les différents pas et le pied XLSX standard,
puis échoue sur le repérage de la ligne DPGF. La lecture du classeur téléchargé
confirme pourtant une ligne à quantité 1, unité `u` et prix HT 760,63 €. Sa
désignation comporte les six espaces d'indentation des trois niveaux de
sections, prévus par l'export. Le sélecteur de ligne du test normalise
désormais ces espaces avec `trim()`, comme le scénario d'intégrité existant.
Les oracles de quantité, unité et prix sont conservés. À ce stade,
l'impression et la borne exacte 913 € n'étaient pas encore qualifiées.

## Recette locale finale — 11 octobre 2026

Commande exécutée :

```powershell
node --env-file=.e2e/local-article/local.env .e2e/product-foundation/run.cjs rounding --production
```

Archive : `.e2e/product-foundation/runs/2026-10-11T02-59-19-091Z/`.
Le rapport et le manifeste concordent : **3 résultats sélectionnés, exécutés
et réussis sur 3**, dont le login ordinaire et les deux scénarios d'arrondi ;
aucun échec, flaky ou saut. Aucun appel modèle, deux classeurs téléchargés.
Exécution sur Chromium desktop, Node 24.19.0, serveur de production local
`http://localhost:3117`, Supabase isolé `http://127.0.0.1:59827`, traces désactivées.

La source enregistrée est `ce5874f54f8202297b74e4ed238e5c48e49d2f1b`
avec le diff local archivé ; `source.changedDuringRun` vaut `false`.
Le build `5OPtggZhYWtSC_z3MGQXs` est celui préparé dans
`.e2e/product-foundation/builds/2026-10-11T02-51-16-198Z/`.
Les trois empreintes de build du manifeste correspondent encore aux fichiers
vérifiés. Les **30 artefacts archivés** ont été relus et leurs SHA-256 vérifiés,
sans divergence.

Le premier scénario observe 912,76 € → 912,00 € au pas de 1 €, 910 € au pas
de 10 €, 900 € aux pas de 50 € et 100 €, puis 912,76 € après désactivation.
Les paramètres et totaux persistent après sauvegarde et rechargement. Le cas
exact 913,00 € reste à 913,00 €, avec ajustement nul. La version créée porte
l'identifiant `834ceabe-031c-4a19-821a-8e3f3b2c7e22` ; les autres identités sont
dans les JSON de fixtures.

La relecture indépendante des deux classeurs téléchargés confirme le pied
standard **760,63 / 152,13 / 912,76 / −0,76 / 912,00 €** et la ligne DPGF
**1 / u / 760,63 €**. L'artefact DOM d'impression contient le même pied.
Le second scénario conserve `nearest`, `up` et le pas `down` atypique de
2,50 € après modification et sauvegarde du titre, avec contrôle du nouveau
titre par API et après rechargement.

| Preuve dans l'archive | SHA-256 vérifié |
| --- | --- |
| `manifest.json` | `05384847b2fede6267692ca554cc02304aa1dbcea8d7174c6bfa1027c22eab0c` |
| `report.json` | `6079986f4fbf9a4b490f1129eb4cc1e71b8989bc72127512cbb7fda3c9217fb9` |
| Téléchargement `001-devis-ARMY-1791687565070-d0a170ae-v1.xlsx` | `6bc4a6cbafc1118b74ed3b0fbf4e428cdbcdd630892f9b53d43e5306991fac69` |
| Téléchargement `002-devis-ARMY-1791687565070-d0a170ae-v1-dpgf.xlsx` | `495333fb22b3f5742586a4dac4aa24a88b3b84093a06e367b5efc3c37c5ba4ed` |
| `business-evidence/business/ARMY-1791687565070-d0a170ae-rounding-print.json` | `5ea5cca233e261680e1e0502449327adb9db0539ccb9c297f0adefdb15c7ef0f` |
| `business-evidence/business/ARMY-1791687565070-d0a170ae-rounding-exact-multiple.json` | `e6cfc7649f4ad291bfe46e2f4ed3204711d29192a49e97adf7cf43676c299bd9` |

Les chemins complets des téléchargements et les empreintes des autres preuves
figurent dans `manifest.json`. La commande, la configuration du runner et les
sources du scénario sont également archivées pour répéter cette recette.

**Limites :** l'impression est contrôlée dans le DOM, sans génération ni
inspection d'un PDF. Les deux scénarios portent sur des brouillons ARMY ; ils
ne qualifient pas une offre déjà émise ou ses snapshots. Cette campagne ne
prouve ni l'affichage mobile, ni les devises USD/GBP, ni l'autoliquidation,
ni une exécution sur Supabase partagé ou un déploiement public.

## Parcours historique rouge à 2 workers : 409 au `PATCH` d'amorçage (18 octobre 2026)

### Défaillance observée

Clone WSL `~/miaouffrage-v1-selection-verify` (Ubuntu 24.04, Node 24.14.0), commande
`E2E_ARMY_WORKERS=2 npm run e2e:army:ci -- critical --app-port 3174`, révision `ef0b8289`
(`ci/v1-totals-journeys-in-pr-selection`, sans modification locale). Cette branche fait entrer
les parcours V1 de totaux dans la sélection critique, sous des propriétaires dédiés
(`bulk-actions-v1-totals`, `supplier-preselection-v1-totals`, `legacy-v1-draft-support.ts`). Elle
ne touche ni ce parcours, ni `fixtures.ts`, ni le code des verrous : elle ne change que la
répartition des parcours entre les deux workers. Résultat : 108/110. Les deux rouges sont ce
parcours et `bulk-edit-sync-sources` (« expected 1.3 to be 1 », défaut distinct, non traité
ici). La même commande sur `main` `c4c1e854` était passée une fois. Preuves :
`.e2e/army/ci/2026-10-18T12-49-48-645Z-critical/` (`critical/report.json` sha256
`cb68401b…ba9d`).

« commercial rounding displays historical modes explicitly and preserves them on unrelated
saves » échoue sur « expected 409 to be 200 » (`commercial-rounding.e2e.ts:207`). La requête
refusée est le `PATCH /api/estimates/<version>` qui sème le mode historique de la troisième
itération (`down`, pas de 2,50 €). Chronologie de la tentative unique (`report.json`) :

- 12:53:17.821 : `browser.goto(…/edit?openSettings=rounding)`, fin de la deuxième itération ;
- 12:53:18.314 : « Arrondi » visible, puis titre et option relus (lecture seule suffit) ;
- 12:53:18.332 : `GET` de la version, qui fournit `updated_at` et `content_revision` ;
- 12:53:18.425 : `PATCH` envoyé, refusé à 12:53:18.511 en `409 Conflict` (`appLog`).

L'autre worker exécutait alors `dashboard-ux` (UX08 à UX14), soit une suite de rendus de pages.
Le rapport ne garde pas le corps de la réponse : le code du refus n'y figure pas. L'écran à
l'échec (`screen-at-failure.txt`) affiche « Connexion… » dans le statut de synchronisation
(`estimate-page-toolbar-autosave-status`), les champs du paramétrage désactivés et le bouton
« Lecture seule ». L'éditeur rechargé ne détenait donc pas encore son bail.

### Cause

`patchEstimateVersion` (`src/lib/estimates/server.ts`) contrôle l'accès, le statut, puis le bail
(`assertDraftLockOwnedByCurrentUser`, `src/lib/estimates/server-context.ts`), puis `If-Match`.
Dans le journal réseau du serveur (`critical/artifacts/server-network.jsonl`), la lecture
`draft_locks` de 12:53:18.505 est la dernière requête Supabase avant le 409 : aucune écriture
n'a été tentée. Codes possibles à ce stade :

- `VERSION_CONFLICT` : exclu à la lecture du code. Entre le `GET` et le `PATCH`, rien n'écrit
  `estimate_versions`. L'acquisition du bail lit la version sans l'écrire
  (`20261018093005_serialize_estimate_draft_lock_acquisition.sql`) ;
- `LOCK_REQUIRED` : aucun bail actif ;
- `CONFLICT` (« déjà verrouillée dans une autre page d'édition ») : bail encore tenu par la page
  déchargée, sous une autre session du même utilisateur.

Mécanisme. `goto` charge un nouveau document. L'ancien libère son bail sur `beforeunload`, par
une requête `keepalive` (`src/hooks/useDraftLock.ts`). Le nouveau prend une nouvelle identité de
session : `getEstimateDraftLockSessionId` (`src/lib/estimates/client.ts`) ne reprend celle de
`sessionStorage` qu'après un vrai rechargement. Il demande son bail une fois la version
brouillon chargée par le client, puis toutes les 5 s tant qu'il ne l'a pas. Le délai comprend
donc cette lecture. La libération de l'ancienne page ne supprime que la ligne de sa propre
session (`src/lib/estimates/locks.ts`) : elle ne peut pas retirer le nouveau bail. `apiRequest`
(`fixtures.ts`) envoie l'identité de session de la page, lue dans la même table que l'éditeur
(`__miaouffrageEstimateDraftLockSessions`). Un `PATCH` parti avant que l'éditeur ait obtenu son
bail est donc refusé.

Un utilisateur ne peut pas envoyer cette écriture. Tant que le bail manque, l'éditeur est en
lecture seule (`isDraftLockPending`, `src/hooks/useEstimateEditorSyncController.ts`) et le
paramétrage est désactivé. Il s'agit d'une course du parcours, et non d'un défaut du produit.
C'est la même forme que V1BT03 (`bb521950`, voir
[Totaux de version après les actions en lot](version-totals-after-bulk-actions.md#v1bt03-rouge-dans-la-suite-full-39113661225-409-sur-la-règle-de-suggestion)).
La course existe depuis l'arrivée du parcours dans `e2e/army/critical` (`28ccc857`, 14/10),
avec la même boucle `PATCH` puis `goto`. Son issue dépend du délai d'acquisition du bail sous
charge. Dans le même run, le `PATCH` de la deuxième itération, envoyé 661 ms après son
`goto`, était passé. Celui de la troisième est parti 604 ms après le sien.

### Correction (`e2e/` seulement)

- `waitForEditorLease` : avant chaque `PATCH` d'amorçage, le parcours attend que le statut de la
  barre d'outils affiche « À jour » ou « Sauvegardé », avec un délai de 30 s. Ce statut n'est
  rendu que pour une version brouillon chargée. Ces deux libellés n'apparaissent que si
  l'enregistrement n'est pas bloqué (`src/hooks/useEstimateEditorAutoSave.ts`). Cela exige
  `!isDraftLockPending` et `!isDraftLockedByOther`, donc un bail détenu par la page. Le délai de
  30 s couvre aussi la redemande toutes les 5 s, quand la page déchargée tient encore le bail.
  Sur un autre statut sans blocage (« Totaux à synchroniser », par exemple), l'attente échoue au
  lieu d'écrire : c'est un échec lisible, sans risque de masquer un défaut.
- L'assertion nomme le code refusé, comme `createdData` depuis `bb521950`.
- Le produit n'est pas modifié. Les oracles (mode, pas, HT, TTC, titre, option sélectionnée) sont
  inchangés.

Cette attente ne masque pas de défaut. Elle attend l'état visible dans lequel un utilisateur peut
faire la même écriture, et ne rejoue aucune requête métier. Si le bail n'arrive jamais, elle
échoue au bout de 30 s, sur « Connexion… » ou « Verrouillé ».

Les autres écritures API des parcours critiques prennent d'abord le bail elles-mêmes par
`POST …/lock`, sur la page où elles écrivent. Elles passent par la fixture `createLineViaApi`
(`bulk-move`, `bulk-edit-sync-sources`, `estimate-integrity`, etc.) ou par un `POST …/lock`
explicite (`stale-save`, `import-optima-v2`). Ce `POST` partage la session de la page avec
l'éditeur. Elles n'ont pas cette course.

### Reproduction et preuves

Clone WSL `~/miaouffrage-rounding-flake`, Ubuntu 24.04, Node 24.14.0, révision `c4c1e854`
(`main`), port applicatif 3175, `E2E_ARMY_WORKERS=2`. La sélection rejoue l'arrondi avec
`dashboard-ux`, que l'autre worker exécutait au moment de l'échec en CI.

Modifications locales jetables, jamais commitées :

| Nom | Contenu |
| --- | --- |
| D | rouge seulement : la route du navigateur critique (`fixtures.ts`) retient 3 s chaque `POST /api/estimates/<id>/lock` |
| M | message de l'assertion seul (le code refusé), sans l'attente du bail |

Boucle `e2e:army:dev-loop` (session `2026-10-18T14-53-39-239Z-dev-loop`, manifeste
`660bbd87…f04c`, build `qyPfD3K3kro28oHb51yWa`). Elle ne constitue pas un run qualifiant.

| Itération | Diff (`diffSha256`) | Sélection | Résultat | `report.json` (sha256) |
| --- | --- | --- | --- | --- |
| 001, rouge | D + M (`b8d81fb6…b16b`) | `--grep "historical modes"` | exit 1, 1/2. Rouge sur la ligne de la CI : « LOCK_REQUIRED: expected 409 to be 200 » (`:207`), au `PATCH` de la deuxième itération (premier rechargement), 836 ms après son `goto`. Écran à l'échec : « Connexion… » | `4e70ea31…f36e` |
| 002 | D + correction (`d2ce4801…e838`) | idem | exit 0, 2/2. Attentes du bail : 4 ms (page du wizard, bail déjà détenu), puis 3 024 et 5 337 ms après les deux rechargements ; aucun 409 | `a203d9fb…7d71` |
| 003 | correction (`9af6364b…414a`) | `--files` arrondi + `dashboard-ux` | exit 0, 32/32. Bail obtenu 599 et 560 ms après le `goto` | `7f2f2820…8424` |
| 004 | M (`23af57d0…1c37`) | idem | exit 0, 32/32 : sans D, la course ne se reproduit pas seule en local | `5092ccc3…0140` |

Sans retenue, le bail arrive environ 560 à 600 ms après le `goto`. C'est à peu près le temps
que met le parcours pour atteindre son `PATCH` (604 ms dans le run de la CI). La marge est
presque nulle, d'où un échec seulement sous charge.

Boucle arrêtée ensuite : état retiré, pile détruite, aucune erreur.

Runs qualifiants, sans D : `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --files
e2e/army/critical/commercial-rounding.e2e.ts,e2e/army/critical/dashboard-ux.e2e.ts --app-port 3175`,
sur `c4c1e854` + correction (`diffSha256` `9af6364b…414a`). Portée `filtered-critical`, pgTAP et
matrice RLS verts.

| Run | Résultat | Bail au `PATCH` (2ᵉ et 3ᵉ itérations) | Preuves (`manifest.json`, `report.json`) |
| --- | --- | --- | --- |
| Q1 | exit 0, 32/32, une tentative chacun (496 s, pile et build compris) | déjà détenu : attentes de 3 et 4 ms ; bail présent 645 et 733 ms après le `goto` | `2026-10-18T15-10-17-513Z-critical` (`37df33cd…8a7c`, `ef605163…2d49`) |
| Q2 | exit 0, 32/32, une tentative chacun (245 s) | pas encore détenu : attentes de 326 et 109 ms ; bail obtenu 846 et 633 ms après le `goto`. Sans l'attente, ces deux `PATCH` seraient partis avant que l'éditeur détienne son bail | `2026-10-18T15-18-33-901Z-critical` (`7c9b26ac…523d`, `19509bf7…b200`) |

Valeurs relues dans Q1 et Q2 (oracles inchangés) : HT 76 063 centimes ; `nearest`, pas 100,
TTC 91 300 ; `up`, pas 1 000, TTC 92 000 ; `down`, pas 250, TTC 91 250. Titre modifié relu par
l'API et après rechargement, option historique toujours sélectionnée. Preuves :
`ARMY-1792336697121-186dd1a6-rounding-historical-{nearest,up,down}.json` (Q1) et
`ARMY-1792336945957-32acffbc-rounding-historical-{nearest,up,down}.json` (Q2). Le premier
parcours du fichier, qui n'utilise pas l'API pour écrire après un rechargement, passe aussi dans
les deux runs.

Après la revue indépendante, le commentaire de `waitForEditorLease` nomme les deux codes (une
ligne devenue deux). C'est la seule différence entre le diff qualifié et le diff final
(`a9609551…0b74`). Sur ce diff final, dans le clone WSL : `npm run typecheck` et
`npx eslint --max-warnings=0` sur `commercial-rounding.e2e.ts` et `fixtures.ts` rendent
exit 0.

**Limites :** la course ne se reproduit pas seule en local (itération 004). Le rouge repose sur
la retenue D, qui force la même fenêtre. Le code du 409 de la CI n'est pas archivé : il est
`LOCK_REQUIRED` ou `CONFLICT`, `VERSION_CONFLICT` étant exclu par lecture. La suite critique
complète à 2 workers n'a pas été rejouée ici ; son autre rouge du 18/10
(`bulk-edit-sync-sources`) reste à traiter à part.
