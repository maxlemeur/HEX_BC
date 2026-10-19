# Migration PowerShell → TesterArmy — 19 octobre 2026

L'inventaire de PR83, base `1d158d72`, comprend **34 fichiers PowerShell :
30 scénarios et 4 helpers/orchestrateurs** (`agent-browser.ps1`, `hex/common.ps1`,
`hex/suites.ps1`, `hex/run-all.ps1`). Cette correspondance remplace les attentes
obsolètes par les contrats actuels, sans supprimer les contrôles de calcul,
persistance et autorisation encore utiles. Le retrait a été appliqué après
qualification : 43 fichiers retirés, dont les 34 PowerShell inventoriés.

Les quinze nouveaux cas et leurs parcours existants concernés ont maintenant
une **exécution commune verte : 61/61 contrôles sur 21 fichiers**, sur le build
`ziMgguFOu74fsPLMyxEer`. Le smoke final réussit aussi desktop/mobile (2/2).
Les profils PDF d'émission réussissent aussi : 5/5 historiques et 4/4 v3,
setup compris. Seule la qualité finale reste à compléter. `army-migration.md`
et les deux audits précédents restent historiques.

## Correspondance des 30 scénarios

Les anciens chemins HEX sont relatifs à `e2e/hex/`, les destinations à `e2e/army/`.
Les identifiants `LEP`/`LEG` désignent les six fichiers détaillés ensuite.
« Équivalent » décrit les assertions dans les sources ; leur qualification exige
une exécution identifiée sur le candidat final.

| Scénario historique | Équivalent Army actuel | Assertion conservée ou remplacée intentionnellement |
| --- | --- | --- |
| `e2e/smoke.ps1` | `anonymous-login.e2e.ts`, `public-navigation.e2e.ts` | Redirection anonyme, champs utilisables, visibilité du mot de passe et navigation connexion/inscription ; desktop/mobile. |
| `e2e/auth.ps1` | `critical/auth.setup.e2e.ts`, `auth-rejection.e2e.ts`, `prehydration-auth.e2e.ts` | Connexion réelle, refus, POST natif sans identifiants dans l'URL ; aucun contrat sur l'ancien fichier de session agent-browser. |
| `ti-140-epic.ps1` | `critical/estimate-integrity.e2e.ts`, `local/engine-v3-creators.e2e.ts`, `local/offer-emission.e2e.ts`, `local/engine-v3-emission.e2e.ts` | Création, édition, duplication, états et documents vérifiés avec montants/provenance ; gardes d'émission actuelles conservées. |
| `est-101-keyboard.ps1` | LEP01, `critical/numeric-entry.e2e.ts` | Tab/Shift+Tab, Entrée/Echap, caret/flèches ; ouverture clavier du popover de section puis création d'une seule ligne au parent attendu. |
| `est-102-inline-edit.ps1` | LEP04, `critical/numeric-entry.e2e.ts`, `numeric-entry-v3.e2e.ts` | Double-clic sélectionne tout, frappe remplace, annulation locale ; PU/total non modifiables et navigables ; Entrée conserve l'ID et les données. |
| `est-103-multiselect.ps1` | LEP02, `critical/bulk-move.e2e.ts`, `bulk-edit-sync.e2e.ts`, V3E06 | Sélection additive, plage Shift, Ctrl/Meta+A ; catégorie/rôle UUID exacts, déplacement et suppression des seuls IDs sélectionnés après confirmation/recharge. |
| `est-104-clipboard.ps1` | LEGCLIP01/02, `critical/numeric-entry.e2e.ts`, `numeric-entry-v3.e2e.ts`, V3E13 | Vraie copie OS puis collage ; TSV exact, mapping doublon bloquant, ligne invalide exclue, fermeture et insertion unique persistée. |
| `est-105-autosave.ps1` | LEP03, `critical/estimate-integrity.e2e.ts` | Cadence automatique réelle de 60 s, badge acquitté et titre/valeurs exacts après sortie et réouverture, sans Ctrl+S. |
| `est-106-undo-redo.ps1` | LEP01/05, V3E05/06, `critical/bulk-edit-sync.e2e.ts`, `local/bulk-actions-v1-totals.e2e.ts` | Ajout/undo/redo et réordre clavier/undo/redo ; ordres, positions, parents, lignes et totaux relus. Les spécialistes de récupération restent conservés. |
| `est-030-supplier-comparison.ps1` | LEGCAT04, `extended/catalogue-connected.e2e.ts` CAT-C03 | Offre réelle à 1200 choisie contre 1000, UUID et HT 4680 persistés ; avertissement non optimal visible dans les détails, y compris après recharge. |
| `est-164-catalogue-suggestions.ps1` | LEGCAT04, `local/supplier-offer-zero-price.e2e.ts`, CAT-C03 | Deux offres datées réellement périmées, suggestions/alternatives API, sélection réelle ; candidat récent distinct du meilleur prix. Un prix zéro explicitement Inclus reste admissible. |
| `ti-143-navigation.ps1` | `critical/estimate-integrity.e2e.ts`, V3E11/15, LEGCUR02 | Parcours Affaires/éditeur/impression actuels ; `/dashboard/estimates` redirige intentionnellement vers Affaires. |
| `ti-144-list.ps1` | LEGACCESS01, integrity et `local/engine-v3-creators.e2e.ts` | Deux affaires possédées visibles, liens/actions Affaires actuels ; duplication et documents dans leurs parcours réels, sans restaurer les anciens menus Chiffrages. |
| `ti-145-create.ps1` | `critical/fixtures.ts`, `local/engine-v3-creators.e2e.ts` V3C01/02/11 | Wizard réel, version/projet créés avec UUID, moteur, coefficients et statut exacts. |
| `ti-146-parameters.ps1` | LEGCAT03, LEGCUR02, `extended/settings-connected.e2e.ts`, V3E10 | Création UI du rôle à 4500 c/h, relecture persistée, paramètres et devise ; l'ancienne marge ne remplace pas la politique de création v3. |
| `ti-147-editor.ps1` | integrity, V3E05, LEP01 | Sections/lignes et parents exacts après réouverture ; contrôle plus fort qu'une simple présence de titre. |
| `ti-148-calculations.ps1` | integrity, `critical/commercial-rounding.e2e.ts`, v3-editor, bulk-actions-v1 | Montants entiers exacts et contrats de chaque moteur ; aucune conversion d'une version historique en v3. |
| `ti-149-duplicate.ps1` | integrity, v3-creators | Nouveaux IDs, hiérarchie/provenance/finances conservées, source inchangée après modification de la copie. |
| `ti-150-status.ps1` | integrity LIF01, offer-emission, engine-v3-emission | Refus du brouillon vide, émission et décisions réelles, instantanés immuables ; aucun simple clic Envoyer/Accepter sans état vérifié. |
| `ti-151-print.ps1` | integrity (impression), offer-emission et engine-v3-emission (PDF) | L'ancien `agent-browser pdf` capturait le rendu Chromium puis vérifiait la présence d'un fichier. L'équivalent plus fort est le PDF émis/stocké : octets, hash et contenu. Profils qualifiés par P5/P4 ci-dessous ; aucune revendication de téléchargement PDF par l'UI. |
| `ti-152-export.ps1` | integrity, `local/engine-v3-exports.e2e.ts` V3X01–07 | Vrais téléchargements XLSX/CSV/BDC, cellules/en-têtes exacts ; noms et formats courants, sans ressusciter Recap/Lignes si le writer ne les produit plus. |
| `ti-153-suggestions.ps1` | LEGCAT03, V3E19 | Règle créée par UI ; aucune mutation avant « Appliquer », puis `unit_code`, catégorie/rôle UUID et coefficients persistés. « Type FO » règle `category_id` ; pas d'application automatique ni de `supply_type_id` arbitraire. |
| `est-027-multi-currency.ps1` | LEGCUR01/02, V3E07, V3X02 | Taux créé/modifié/désactivé/filtré/supprimé ; saisie USD, carte/tableau Affaires et ligne/totaux imprimés exacts après relecture. |
| `ti-141-db-rls.ps1` | LEGACCESS01, `critical/access-boundaries.e2e.ts`, matrice SQL/RLS conservée | Deux tenants réellement distincts : liste étrangère absente, API et page étrangères refusées, retour propriétaire sans mutation. Le partage au sein du tenant reste autorisé. |
| `ti-142-types.ps1` | LEP01, créations Army, `npm run typecheck` conservé | Création section/ligne sans `console.error`, erreur ou rejet non géré. L'ancien script n'était pas un typecheck. |
| `ti-182-assemblies.ps1` | LEGASM01, `local/assembly-totals.e2e.ts` | Désignation vide refusée sans POST ; ouvrage réellement créé serveur, relu/recherché, puis inséré avec UUID, provenance, enfants et montants exacts. |
| `prices-page.ps1` | LEGCAT01, CAT-C02 | CSV replié/déplié, recherche 1→0→1, formulaires réels, historique accentué, actualisation sans mutation. |
| `prices-import-guided.ps1` | LEGCAT02, `takeoff/team-b-user-stories.e2e.ts` US-4.1 | Vrai `MM_BDC_V1.2.csv` Windows-1252, hash et compteurs exacts : 539 détectées, 412 ignorées, 127 à résoudre. Aperçu uniquement, comme l'ancien script ; l'import confirmé relève d'US-4.1. |
| `dpgf-import-flow.ps1` | `critical/dpgf-import.e2e.ts` DPGF01–03 | Vrais fichiers, mapping, import et liaison sans mutation ; terminologie et étapes du flow courant. |
| `dpgf-affaire-wizard-editor-flow.ps1` | v3-creators V3C02/06/12 | Création liée DPGF, moteurs v3/v2, lignes/montants/provenance ; action source visible et création vierge possible quand aucun template n'est disponible. |

## Quinze nouveaux cas qualifiés ensemble

Fichiers sous `e2e/army/local/`. Les quinze cas sont tous verts dans le reçu
commun **Q61** ci-dessous. Les dernières réussites d'itération sont conservées
comme historique de diagnostic, relevé dans les `critical/report.json` 001–008 ;
leur union sur des sources différentes n'est pas la preuve finale.

| Fichier | Cas | Qualification commune | Historique 001–008 |
| --- | --- | --- | --- |
| `legacy-editor-parity.e2e.ts` | LEP01 clavier/création/undo/redo ; LEP02 sélection/actions en lot | Q61 : verts | 005 ; 005 |
| `legacy-editor-parity.e2e.ts` | LEP03 autosave ; LEP04 édition/lecture seule ; LEP05 réordre/undo/redo | Q61 : verts | 001 ; 003 ; 007 |
| `legacy-clipboard-parity.e2e.ts` | LEGCLIP01 copie OS ; LEGCLIP02 mapping/exclusion | Q61 : verts | 008 ; 008 |
| `legacy-catalogue-parity.e2e.ts` | LEGCAT01 prix ; LEGCAT02 BDC ; LEGCAT03 règle ; LEGCAT04 offre non optimale | Q61 : verts | 005 ; 005 ; 008 ; 006 |
| `legacy-currency-parity.e2e.ts` | LEGCUR01 taux ; LEGCUR02 USD | Q61 : verts | 003 ; 004 |
| `legacy-access-parity.e2e.ts` | LEGACCESS01 liste multi-tenant et refus du détail étranger | Q61 : vert | 003 |
| `legacy-assemblies-parity.e2e.ts` | LEGASM01 création/recherche/insertion serveur | Q61 : vert | 003 |

Les rapports, manifestes et faits métier sont sous
`.e2e/army/ci/2026-10-19T06-39-41-270Z-dev-loop/iterations/001-…/` à `008-…/`.
Leur union contient les quinze cas sans transformer un rouge, un skip ou un setup
échoué en réussite. Le nouveau garde de préhydratation login est distinct de
cette union.

## Trois défauts produit reproduits

1. **Focus clavier dans la cellule active.** L'effet de navigation reprenait le
   focus d'un bouton ou d'une poignée contenus dans la cellule. LEP01 est rouge
   en 003 sur le vrai déclencheur de section qui perd son focus. Le correctif de
   `useSpreadsheetNavigation.ts` préserve tout descendant actif de la cellule,
   tout en laissant la navigation changer de cellule ; LEP01 et LEP05 ont ensuite
   leurs verts d'itération. Les soucis de sélection d'un ancien menu et de
   disponibilité du listener DnD sont des corrections d'oracle distinctes.
2. **USD affiché comme EUR dans la liste Affaires.** En 002, la version relue
   est USD/123456 c mais sa carte affiche `1 234,56 € HT`. Le lecteur RLS charge
   maintenant la devise des seuls IDs courants en lots bornés, puis la transmet
   aux cartes et au tableau. LEGCUR02 réussit carte/tableau/impression en 004.
   La revue a ajouté un garde contre la course RPC→lecture : même ID, total
   RPC 1000 puis lecture USD/2000 doit refuser `409 VERSION_CONFLICT` ; lecture
   cohérente USD/123456 doit réussir. Ces deux régressions sont écrites avant
   correction ; rouge isolé observé puis 57 tests serveur verts sur checkout.
   Le navigateur ne peut ordonnancer ces deux requêtes serveur internes sans
   remplacer leur résultat : c'est la justification de cette isolation conservée.
3. **Commande Afficher active avant hydratation.** Le smoke desktop clique une
   commande SSR encore sans handler ; elle ne change pas le champ. `tap()` du
   SDK 0.15.2 est un unique `locator.click`, comme sur mobile. En 009, JavaScript
   retenu, l'oracle login échoue exactement sur le toggle SSR resté actif.
   Le correctif désactive ce seul bouton jusqu'à l'hydratation avec
   `useSyncExternalStore` ; champs et soumission native POST restent utilisables.
   L'itération 010 réussit le setup, les deux gardes de préhydratation et
   LEGCLIP02 (4/4) sur le build `c7BzoK3HwN0K-VNDu5HKd`. Le smoke suivant
   s'arrête sur `POLICY_DENIED` du SDK lors d'une nouvelle lecture de l'attribut
   `type` du champ sécurisé, avant les taps : ce refus n'est pas un défaut
   produit. Ces trois lectures ont été retirées, sans lecture DOM de rechange ;
   les deux taps réels et `aria-pressed=false → true → false` restent exigés.
   Le smoke corrigé réussit ensuite desktop et mobile (2/2), reçu S2 ci-dessous ;
   les deux gardes de préhydratation sont également verts dans Q61.

Les rouges et reprises ne sont pas effacés. La course devise est documentée dans
`src/lib/affaires/server.test.ts` ; les comptes rendus temporaires correspondants
restent `/private/tmp/mergeone-affaire-currency-race-{before,after-draft}.json`.
Le second nom désigne un candidat hors checkout, pas l'exécution finale.

## Contrats et limites préservés

- **Autosave :** 60 s de debounce/max-wait restent le contrat. Après structure
  v2, les lignes peuvent être écrites avant le pied : une attente d'acquittement
  de 90 s observe cette cadence sans Ctrl+S. Le reload exige ensuite zéro
  dialogue natif. Un état intermédiaire « Synchronisation » trop bref n'est pas
  exigé ; un pied persistant faux ou un vrai dépassement reste un échec.
- **Presse-papiers :** LEGCLIP01 attend la sélection React et la fin du vrai
  `writeText` ou `execCommand` natif, puis utilise Ctrl/Meta+V. Les observateurs
  forwardent les appels et leurs erreurs ; aucun contenu OS n'est simulé.
  LEGCLIP02 injecte explicitement un événement DOM avec le TSV fourni : il prouve
  mapping/exclusion/persistance, pas le presse-papiers OS.
- **Champ sécurisé :** la politique du SDK interdit l'oracle ajouté sur le
  `type` du champ mot de passe. Le smoke conserve les vrais taps et les états
  accessibles du toggle ; aucun `evaluate` ne contourne cette politique.
- **TVA v3 :** le TSV n'exporte pas la TVA ; les nouvelles lignes héritent du
  taux du devis. Deux lignes à HT 4063 c donnent HT 8126, TVA de groupe 1625 et
  TTC 9751 ; taxes de ligne 813/812, centime restant au plus petit UUID. L'ordre
  d'affichage ne décide pas de cette répartition. Les saisies copiées restent
  identiques, les projections individuelles peuvent changer ; deux TVA de 813
  doivent échouer. Aucun arrondi produit n'a été modifié.
- **Variantes multidevises hors lot :** le détail financier déplié de
  `AffairesDenseTable.tsx` et le hub `AffaireHubSections.tsx` utilisent encore
  leur autre DTO et `formatEUR`, constat de source seulement. Aucun repro exécuté
  ni correction de ces variantes n'est revendiqué par le rouge de la carte.
- **Spécialistes conservés :** SQL/RLS, types, dépendances, architecture,
  OpenAPI, corpus des moteurs historiques, races/récupération et budgets restent
  utiles. « Tout en Army » concerne le runner des parcours UI ; les moteurs
  historiques et ces protections ne deviennent pas obsolètes par leur âge.

## Qualification finale — preuves locales

| Preuve sur sources finales figées | Révision/build, commande, versions effectives | Résultat et artefacts |
| --- | --- | --- |
| Quinze cas de parité et parcours existants concernés | Q61 : build `ziMgguFOu74fsPLMyxEer`, sources et commande ci-dessous | 61/61 sur 21 fichiers ; 0 échec/interruption/flaky/skip sélectionné, 11 téléchargements, 0 appel modèle ; pgTAP/RLS et privacy verts |
| Smoke anonyme desktop/mobile et préhydratation login/signup | S2 : run `01a1532e-cfcf-7df4-9dde-cdf0a57230bf` ; préhydratation incluse dans Q61 | 2/2, un essai chacun, sans modèle ; POST natif et garde URL conservés |
| Émission PDF historique/v3 : contenu, octets stockés, hash/immutabilité | P5/P4 : profils production servis, reçus et commandes ci-dessous | 5/5 et 4/4, setup compris ; zéro échec, interruption, flaky, skip sélectionné ou appel modèle ; aucun téléchargement UI déduit de la page imprimable |
| Qualité locale finale | `npm run verify:pr`, Node 24.19.0, checkout après retrait ; journal ci-dessous | Réussi : 3279 Node, 820 jsdom, 12 contrôles de couverture critique ; trois skips Node explicités ci-dessous |
| Protections CI du commit publié | [Checks de PR83](https://github.com/maxlemeur/HEX_BC/pull/83/checks) | Preuve distincte à lire sur le commit final ; aucun ancien vert de `1d158d72` ne lui est attribué |

**Q61 — qualification neuve sur sources figées.** Backend natif local éphémère,
Node 24.19.0, `e2e` 0.21.2, `@e2e-dev/web` 0.15.2, un worker, Chromium desktop.
Campagne du `2026-10-19 08:02:50.456 UTC` au `08:16:04.627 UTC` ; run
`01a1532f-b0fb-7431-a9ac-4f768efe4bf4`. Build `ziMgguFOu74fsPLMyxEer`.
Source : HEAD `1d158d7232e675d62e7846c7f8a6ccfef2618d9d` **avec WIP**,
`source.diffSha256=a553d03c113ce5751f1c0ff73c51658427e64a45ac10ed160ca3898fa5559933` ;
les six parcours encore non suivis sont identifiés individuellement dans
`source.untrackedJourneyInputs`. Le seul nom de HEAD ne décrit pas ce candidat.

Commande de relance de la sélection effectivement enregistrée :

```sh
npm run e2e:army:ci -- full --app-port 3128 --grep '^(LEP0[1-5]|LEGCLIP0[12]|LEGCAT0[1-4]|LEGCUR0[12]|LEGASM01|LEGACCESS01|LIF01|DPGF03|V3C0[126]|V3C1[12]|V3E0[56]|V3E1[1359]|V3X0[1-6]|CAT-C0[23]|SET-C01) |^(creation persists|duplication preserves|downloaded XLSX|numeric entry|bulk move persists|bulk edit sync|associating a catalogue article|CSV DPGF becomes|opaque CSV DPGF)|US-4\.1[abcd]? |pre-hydration submission'
```

Reçus : `.e2e/army/ci/2026-10-19T08-02-50-455Z-full/manifest.json`,
`.e2e/army/ci/2026-10-19T08-02-50-455Z-full/full/report.json` et
`.e2e/army/ci/2026-10-19T08-02-50-455Z-full/builds/2026-10-19T08-02-55-466Z-5f03acaa/manifest.json`.
La sélection préalable exacte est conservée dans
`/private/tmp/mergeone-audit-pr-plcamq1n/legacy-qualification-selection.json`
(61 couples fichier/cas sur 21 fichiers, aucun problème), et répétée dans le
manifeste. Portée **filtered-full** : les 61 contrôles, setup compris, sont
qualifiés ; cela ne qualifie ni les 246 résultats découverts, ni la phase
development non sélectionnée, ni les spécialistes PDF d’émission.

Q61 est **réutilisé**, sans nouvelle exécution après les deux profils PDF et le
retrait. Les sources applicatives, fixtures et 61 assertions sélectionnées par
Q61 sont inchangées ; les corrections ultérieures concernent l'entrée des seuls
profils d'émission, leurs deux actions UI et le retrait de fichiers PowerShell,
commandes et références qui n'étaient pas leurs entrées runtime. Les hashes
ci-dessus décrivent le candidat exécuté avant retrait ; ils ne désignent pas le
diff final après suppression. La qualité finale vérifie ce dernier checkout.

**S2 — smoke final.** `npm run e2e`, origine locale `http://localhost:3130`,
Node 24.19.0 et mêmes versions SDK ; deux cibles anonymes fraîches, desktop/mobile.
Run `01a1532e-cfcf-7df4-9dde-cdf0a57230bf`, du `2026-10-19 08:02:19.361 UTC`
au `08:02:24.292 UTC` : 2 sélectionnés/exécutés/réussis, zéro échec,
flaky ou skip sélectionné, un essai chacun, aucun appel modèle. Les deux cas
agent de `public-navigation.e2e.ts` sont hors filtre et ne sont pas des réussites.
Les variables publiques réelles du backend local étaient présentes ; aucune
valeur de session ni identifiant secret n’est nécessaire dans ce registre.
Reçu : `.e2e/army/runs/2026-10-19T08-02-19-035Z/manifest.json` et
`report.json` dans ce même dossier (également `.e2e/army/manifest.json`).
Résumé de contrôle :
`/private/tmp/mergeone-audit-pr-plcamq1n/army-smoke-final-summary.json`,
`reportSha256=3f996980161f5032dc398a4a5eae63df83985db2ecc4fe7fa316a9cc9a93535a`.

**P5/P4 — PDF réellement émis.** Deux exécutions filtrées sur backend natif
éphémère, production servie, Node 24.19.0, `e2e` 0.21.2 et
`@e2e-dev/web` 0.15.2, un worker et zéro retry. HEAD est
`1d158d7232e675d62e7846c7f8a6ccfef2618d9d` avec WIP,
`source.diffSha256=03e16a530ad3c1b309d1b198a1b898609bc7d74c6fbd8ec2af860e54dc3d0004`.
Les manifestes et `phase.json` conservent l'identité du build, inchangé pendant
chaque exécution, les PDFs collectés, leurs octets, hash et contenu extrait.

```sh
npm run e2e:army:ci -- calc-v3 --app-port 3128 --phase emission --grep '^OF0[0124] '
npm run e2e:army:ci -- calc-v3 --app-port 3128 --phase emission-v3 --grep '^V3M0[156] '
```

- **P5**, run `01a15343-e28f-7518-895f-6c46c5401451`, du
  `2026-10-19 08:25:20.430 UTC` au `08:26:03.544 UTC` : setup et
  OF00/01/02/04, **5/5**. Confirmation, émission manuelle, CTA anonyme et renvoi
  conservent l'identité et le PDF figé. Quatre reçus PDF sont collectés ; le
  renvoi retrouve le même hash. Reçus :
  `.e2e/army/ci/2026-10-19T08-24-37-411Z-calc-v3/emission/phase.json` et
  `sdk/report.json` dans ce dossier ; rapport SHA-256
  `7dc2ddf0b7775fca2a980b667d5fd3bfa50b325996e5986a2e584d4c197188d0`.
- **P4**, run `01a15345-e55e-7030-b244-32c621e808d9`, du
  `2026-10-19 08:27:32.285 UTC` au `08:28:03.719 UTC` : setup et
  V3M01/05/06, **4/4**. Montants oracle, scellement, identité émise conservée
  malgré modification ultérieure de l'affaire/profil, CGV et pieds HT/TTC
  vérifiés ; cinq reçus PDF collectés. Reçus :
  `.e2e/army/ci/2026-10-19T08-26-49-346Z-calc-v3/emission-v3/phase.json` et
  `sdk/report.json` dans ce dossier ; rapport SHA-256
  `cec6e2fdb715af64c14b150ebbb4d2d7c1e96c58628583628cfd026433528704`.

Ces neuf résultats ont un essai chacun, zéro skip/flaky/interruption et zéro
appel modèle. Ils qualifient ces sélections, pas tous les cas découverts des
profils. Les synthèses contrôlées sont
`/private/tmp/mergeone-audit-pr-plcamq1n/legacy-pdf-emission-corrected-summary.json`
et `legacy-pdf-emission-v3-corrected-summary.json` dans ce même dossier.

Le rouge du `08:18:26 UTC` reste conservé : `app.clearState()` passait par
l'accueil, qui tentait un GET du CDN cdnjs pour ThreeJS ; la garde réseau a
correctement bloqué cette dépendance. L'entrée des seuls profils d'émission
passe désormais directement par `/login`. Deux boucles de reclique dans
`engine-v3-emission.e2e.ts` ont également été retirées : chaque action est unique
et attend son résultat exact. Aucun délai, retry ou garde réseau n'a été
assoupli. Il s'agit de corrections de fixtures/parcours, distinctes des trois
bugs produit ci-dessus. Le PDF émis/stocké est une preuve plus forte que la
capture Chromium de l'ancien script ; elle ne prouve pas un téléchargement PDF
par l'interface.

Les six fichiers de parité sont inclus dans les profils critical sur backend
local et full ; la carte d'impact intégrée les rattache aux vrais consommateurs
(wizard, éditeur, liste/détail Affaires, impression, prix, devises et ouvrages).
Les spécialistes d'émission et de couverture gardent leurs profils propres :
leur existence dans le dépôt n'est pas une exécution de cette campagne.

## Retrait appliqué après qualification

Le reçu `/private/tmp/mergeone-audit-pr-plcamq1n/legacy-retirement-applied.json`
enregistre le retrait selon le plan revu et les hashes contrôlés : **43 fichiers**,
soit les 30 scénarios et quatre aides PowerShell, `e2e/run-ps1.mjs`, et les huit
fichiers de tests/support dont la seule source était ce runner. Les douze
commandes npm correspondantes sont retirées ; `package.json`,
`.github/workflows/quality-gate.yml`, `AGENTS.md`, `README.md` et `e2e/README.md`
sont adaptés. Le préflight PowerShell de huit lignes disparaît avec ses seuls
consommateurs ; les autres contrôles qualité et sécurité restent requis.

L'application, les moteurs historiques, les protections SQL/RLS et les
spécialistes utiles restent conservés. Les audits historiques ne sont pas
réécrits. Le reçu confirme que l'index Git et le checkout original n'ont pas été
modifiés par ce retrait. Ce registre annonce le retrait local effectué et sa
qualité locale ; les checks de la tête publiée de PR83 constituent la preuve CI.

`npm run verify:pr` a terminé avec le code 0 le 19 octobre, de
`08:32:02 UTC` à `08:33:26 UTC` (84 s observées), sur HEAD `1d158d72` et les
72 fichiers stagés de ce lot après retrait. Le journal est
`/private/tmp/mergeone-audit-pr-plcamq1n/verify-pr-army-final.log` : zéro avis de
dépendance bloquant, 760 signatures et 218 attestations vérifiées, architecture,
OpenAPI, types et lint verts ; 3279 tests Node, 820 jsdom et 12 contrôles de
couverture critique réussis. Les trois skips Node sont les deux cas RLS hors
contexte natif (exécutés avec succès par les campagnes ci-dessus) et le garde
Bash >= 4, non disponible dans ce PATH macOS et obligatoire dans la CI Linux.
Ils ne sont pas comptés comme réussis. Cette dernière édition du registre
ajoute seulement le résultat de la commande ; les sources vérifiées ne changent
pas et son diff est contrôlé séparément.
