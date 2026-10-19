# Audit des tests et du code dormant — 19/10/2026

Base : `f1a397d71a205274346bbbaf5b20a66670a5840d`, checkout `main`,
initialement propre et en avance d'un commit sur `origin/main`. Le commit
préexistant est conservé. Les changements de cet audit restent locaux.
Runtime des contrôles : Node **24.19.0**, Vitest **4.1.11**, e2e **0.21.0**
et `@e2e-dev/web` **0.15.0**, sans modification de dépendances.

## Contrat et méthode

Comportement attendu : conserver les parcours actifs et leurs protections,
supprimer les implémentations qui ne sont plus atteignables, et faire échouer
un lanceur qui reçoit un faux succès après omission du parcours.

L'inventaire initial compte **475 fichiers Vitest sous `src/`**. Trois agents
ont examiné séparément les modules applicatifs, les tests isolés et les runners.
Le graphe de modules, les recherches de symboles dans le code exécutable,
l'historique des remplacements et les chemins actifs ont été recoupés. Le graphe
inclut les imports dynamiques littéraux et `new URL(..., import.meta.url)` ;
les workers CSV/XLSX sont ainsi conservés comme véritables points d'entrée.
Le seul âge d'un fichier, son nom « legacy », un mock ou une couverture E2E
supposée ne suffit pas à décider sa suppression.

Le fichier local `test-results/test-legacy-audit-2026-10-19/reachability.json`
reconstruit le graphe depuis les blobs du HEAD initial, avant les suppressions :
il donne les SHA-256, importeurs et fermetures inverses des 16 modules retirés.
La règle `runtime-unused-modules` de la carte d'impact constituait un indice ;
chaque entrée a été vérifiée avant retrait de la règle.

## Suppressions démontrées

| Modules retirés | Preuve et chemin actif conservé |
| --- | --- |
| `OnboardingIntakeDropzone`, `QuickCreateAffaireDialog` | Déconnexions dans `6d24ae22` et `774ffa25`. La création monte `AffaireOnboardingClient` ; les pièces passent par `IntakeWorkspace` → `IntakeDropzone`. Les actions partagées de création restent en place. |
| `SupplierCatalogItemModal` | Seul consommateur : un bloc de test. `PricesManager` utilise `SupplierOfferFormModal`, qui soumet SKU, URL et prix ensemble. Les trois tests du formulaire actif et les parcours catalogue sont conservés. |
| `ProjectTakeoffJobList` | Remplacé explicitement par `TakeoffActivityCenter` dans `f3876370`. Le `TakeoffJobList` des versions demeure actif et conservé. |
| `evidence-source-context` | Importé seulement par son test. `EvidencePanel` assure sa propre validation des URL et de la page source ; ses régressions de sécurité restent exécutées. |
| `ui/{checkbox,empty,select,switch,table}.tsx`, `useEstimateLineTruthVisibility` | Aucun importeur, réexport, point d'entrée de framework ou chargement dynamique trouvé. Aucune page ne monte ces implémentations. |
| `affaires/route-segments` | Seul consommateur : son test. Le normaliseur ne protégeait aucune route réelle ; `/affaires/new` reste une route statique Next. |
| `estimates/assembly-library` | Seuls consommateurs : ses tests. Le client actif utilise `fetchEstimateAssemblies` → API → `listEstimateAssemblies`. Les RPC SQL, migrations et contrôles d'autorisation sont conservés. |
| `estimates/calc-context` | Chargeur explicitement jamais raccordé, importé uniquement par ses tests. Les moteurs 1/2/3, contrats de versions, corpus et protections de lecture complète ne sont pas supprimés. |
| `estimates/portal-document-contract` | Ancien helper importé seulement par son test. Le portail passe par `loadPortalOffer` → `loadVerifiedOfferDocument` → `parseOfferDocumentProof`. Son ancien repli sans document contredisait la preuve documentaire exigée aujourd'hui. |
| `lib/reference` | Aucun consommateur. Les références de commande sont générées dans les transactions SQL de création, et lues depuis leur résultat. |

Au total : **16 modules et 7 suites dédiées supprimés**. Les **38 cas obsolètes**
retirés comprennent 37 cas de ces suites et le seul cas de l'ancien modal
fournisseur dans une suite mixte. Un mock inactif de création rapide est retiré.
Aucun test actif n'est retiré pour un simple chevauchement présumé avec E2E.
Le nouvel ensemble comporte **469 fichiers Vitest** : 475 − 7 + 1 régression CLI.

Dans `e2e/hex/common.ps1`, `Set-EditableTitleValue` est également supprimé
(57 lignes) : sa définition était sa seule référence, sans dispatch dynamique
par ce nom. `Add-Chapter` et `Add-Line` utilisent les deux helpers conservés
`Set-LatestSectionTitleValue` et `Set-LatestLineTitleValue`.

Les références courantes aux modules supprimés sont corrigées dans la carte
d'impact et les guides de domaine. Les rapports datés restent des preuves
historiques et ne sont pas réécrits.

## Défaut réel corrigé : faux succès du runner PowerShell

Plusieurs anciens parcours impriment `PASS (skipped...)` et retournent zéro
quand une fixture ou le transport de collage échoue. Le lanceur npm héritait
ce zéro, et `run-all.ps1` pouvait ensuite annoncer une suite réussie.

`e2e/run-ps1.mjs` transmet toujours les sorties du processus enfant, mais
détecte ce marqueur explicite sur stdout et stderr, même scindé entre chunks
ou avec formatage ANSI. Un enfant terminé avec zéro après ce marqueur donne
désormais **1**. Un vrai PASS reste zéro ; un code d'échec existant est conservé.
L'annulation est transmise au shell possédé et produit **130**, même si le shell
se ferme proprement avec zéro.

L'exception de test isolé est nécessaire : un navigateur ne peut pas vérifier
la classification de sortie du processus parent. La régression exécute le
vrai CLI Node avec un exécutable PowerShell temporaire, sans identifiants,
réseau ni données métier. Elle précède la correction : **8 échecs / 2 succès**,
puis une régression d'annulation **1 échec / 10 succès** ; résultat final
**11/11**, sans skip sur ce Mac. Les tests ne prétendent pas réparer les
produits ou exécuter les parcours PowerShell eux-mêmes.

Preuves : `legacy-runner-red.log`, `legacy-runner-cancellation-red.log`,
`legacy-runner-green.log`, `legacy-tooling-evidence.json` dans le dossier
`test-results/test-legacy-audit-2026-10-19/`.

## Défaut réel corrigé : découverte ESLint des autres checkouts

La vérification globale a parcouru trois copies Git distinctes sous
`.claude/worktrees/`, malgré leur exclusion Git. Résultat : **116 053 diagnostics
dans 1 966 fichiers de ces copies, zéro fichier du checkout courant avec un
diagnostic** (`lint-discovery-failure.json`, `verify-pr-final.log`).

Une régression exécute la vraie API ESLint avant la correction : le chemin d'une
copie était inclus à tort (**1 échec / 9 succès**). L'ajout ciblé de
`.claude/worktrees/**` aux exclusions globales donne **10/10**. Le même test
vérifie qu'une requête Supabase invalide dans `src/` conserve une erreur de
sévérité 2 et que `.claude/hooks` reste contrôlé. Cette isolation couvre la
découverte du CLI, qu'un parcours navigateur ne peut pas vérifier.

Les trois worktrees ont été identifiés par leurs métadonnées Git, en lecture
seule ; aucun de leurs fichiers ou WIP n'a été modifié. Les règles appliquées
au code courant restent inchangées. Preuves : `eslint-worktree-red.log`,
`eslint-worktree-green.log`, `eslint-worktree-evidence.json`.

## Validation

Les commandes utilisent le Node 24 installé via
`PATH=/Users/timax/.local/share/mise/installs/node/24.19.0/bin:$PATH`.
Les preuves locales sont sous `test-results/test-legacy-audit-2026-10-19/` ;
le manifeste final conserve révision, modifications, hashes, commandes et limites.

| Contrôle | Résultat |
| --- | --- |
| Régressions Node conservées : offre figée, portail accept/reject/page, versions moteur, gardes du métré | **218/218**, JSON `retained-node.json` |
| Régressions jsdom conservées : `EvidencePanel`, revue, métadonnées de plans | **16/16**, JSON `retained-evidence-jsdom.json` |
| Création, pièces, activité métré, ancienne liste active, formulaires conservés | **19/19**, `retained-jsdom.{log,json}` et manifeste associé |
| Régression du vrai CLI avec enfant temporaire | **11/11**, `legacy-runner-green.log` |
| Régression de découverte ESLint et compatibilité des globs Next | **10/10**, `eslint-worktree-green.log` ; violations du code courant toujours signalées |
| Revues indépendantes | Aucune anomalie actionnable sur les suppressions et la correction ; contre-vérification des signaux, du fallback et des arguments Unicode |
| `git diff --check` | Réussi |
| `npm run verify:pr` | **Réussi, sortie 0** : audits npm/signatures, architecture, OpenAPI, typecheck, lint, **3 288 Node + 820 jsdom**, puis **12/12** de couverture critique ; `verify-pr-complete.log` |
| TesterArmy anonyme | **2/2**, desktop et mobile Chromium, zéro appel modèle, zéro skip sélectionné ; `army-smoke-local.log` et `.e2e/army/manifest.json` |

Les suites ciblées s'exécutent avec `npm test -- --project=node <fichiers>` ou
`--project=jsdom <fichiers>` ; les listes exactes et identités de chaque run
figurent dans les manifestes. Régression du CLI :
`npm test -- --project=node src/test/legacy-powershell-runner.test.ts`.

Le smoke a d'abord été arrêté par l'interdiction sandbox d'écouter sur localhost
(`EPERM ::1:3107`, `army-smoke.log`), avant une exécution autorisée réussie.
Son manifeste indique `changedDuringRun: false` ; les deux captures et traces
sont conservées dans l'archive nommée par ce manifeste. Il ne qualifie que la
redirection anonyme et le formulaire hydraté, pas une session métier connectée.
Une tentative de qualité a également détecté l'absence de `NODE_ENV` dans les
environnements minimaux du nouveau test : corrigée explicitement avec `test`,
sans hériter des secrets de l'environnement parent (`verify-pr-network.log`).
Le smoke précède uniquement la correction des exclusions ESLint et son test ;
ses entrées applicatives n'ont pas changé et sa portée est réutilisée comme telle.

La chaîne finale conserve **trois skips Node**, pas des succès : les deux cas
de `rls.e2e.test.ts` nécessitent la pile éphémère et `RLS_E2E=1` ; le test de
garde Supabase exécuté en bash demande bash ≥ 4, absent du PATH de ce run Mac.
Ces conditions préexistantes ne sont pas assouplies. Aucun changement SQL/RLS
n'est effectué et aucune qualification de base de données n'est revendiquée.
Les seuils critiques existants passent : tenant-context à 100 %, service-role
à 84,61 % statements / 80 % branches / 100 % fonctions / 91,66 % lignes,
required-environment à 100 %. Les warnings Vite de chargement de config et
MaxListeners sont conservés dans le journal ; aucun échec d'assertion ne subsiste.

## Limites et suites à conserver

- **PowerShell et agent-browser absents** : aucun ancien parcours navigateur
  n'a été qualifié. Les scripts restent des entrées npm explicites ; leur
  suppression globale n'est pas démontrée. Le test de processus ajouté est
  POSIX ; Windows le déclare explicitement ignoré.
- Le contrôle de faux succès porte sur `PASS (skipped...)`. Les anciens WARN
  qui omettent une assertion restent à qualifier. Une exécution directe par `pwsh`,
  hors du lanceur npm, n'est pas protégée par ce contrôle.
- Les assertions exactes des parcours catalogue, hub et portail sont conservées ;
  leur lecture n'est pas présentée comme un nouveau passage E2E connecté.
  Aucun accès à un backend partagé, envoi d'email ou changement de données
  personnelles n'a été nécessaire.
- `quickCreateAffaire` et `startAffaireManualEstimate` restent exportées.
  Leurs composants consommateurs ont disparu, mais la compatibilité des server
  actions exportées et leurs helpers partagés demande une preuve distincte.
- Aucun moteur historique, schéma, RPC public, migration, RLS, seuil de couverture,
  protection CI ou attente métier active n'est retiré ou affaibli.

Aucun commit, push, PR, déploiement ni migration distante n'est effectué.

Lacunes préexistantes constatées dans le flux des anciens scripts, sans nouvelle
reproduction navigateur et sans suppression de leurs assertions :

| Fichier | Déclencheur et portée manquante |
| --- | --- |
| `e2e/hex/prices-page.ps1:142` | Sans action « Voir / modifier », les assertions du modal d'édition sont omises ; la fin affiche tout de même `ALL CHECKS PASSED`. |
| `e2e/hex/est-106-undo-redo.ps1:597` | Le catch externe transforme les échecs des vérifications strictes en WARN, avant le PASS final. Des catches internes omettent aussi des vérifications de suppression, bulk, reorder et rechargement. |
| `e2e/hex/est-102-inline-edit.ps1:572` | Si le prérequis de saisie Ctrl+A échoue, l'assertion Ctrl+Z n'est pas exécutée. |
| `e2e/hex/ti-153-suggestions.ps1:125` | Une unité ou un type inattendu produit un diagnostic, puis un PASS. |

Ces constats prouvent des trous dans les anciens tests, pas des défauts produit
reproduits. Les diagnostiquer dans leur vrai environnement reste nécessaire ;
ils ne servent pas de preuve de remplacement pour supprimer une couverture.

### Suivi demandé par le propriétaire

Les branches ci-dessus ont ensuite été corrigées, avec des régressions exécutant
leur vrai code PowerShell avant puis après correction. Les résultats du premier
audit restent ceux de leur exécution ; le [suivi de propagation des assertions](legacy-assertion-propagation-2026-10-19.md)
décrit les corrections, les nouvelles preuves et la limite des fixtures isolées.
