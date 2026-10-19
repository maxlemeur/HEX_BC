# Assertions legacy : propagation des échecs — 19/10/2026

Suite de l'[audit des tests](test-legacy-audit-2026-10-19.md), à la demande du
propriétaire : corriger les assertions absorbées par des WARN et relancer les
contrôles pertinents. Base Git : `f1a397d71a205274346bbbaf5b20a66670a5840d`,
avec les modifications locales de l'audit précédent conservées.

## Contrat observable

Un prérequis ou un résultat obligatoire manquant doit interrompre le parcours
avec un code non nul et son diagnostic. Le PASS final n'est atteignable que
quand tous les contrôles requis réussissent. Le `finally` doit fermer la session
dans les deux cas. Un repli peut rester s'il vérifie le même résultat exact ;
il ne doit pas remplacer l'interaction que le scénario prétend tester.

Cette correction porte sur les scripts de validation, sans modification du
produit, des moteurs de calcul, du schéma, de la RLS ou des données personnelles.
Les suppressions du premier audit restent distinctes de ce correctif.

## Modifications

| Parcours/helper | Résultat maintenant obligatoire |
| --- | --- |
| `est-101-keyboard.ps1` | Navigation du tableur et création par clavier, sans substituer un clic souris à un Enter défaillant. Les quantités actuelles sont des champs texte ; les flèches naviguent entre cellules, sans simuler des incréments de champ number. Le menu d'ajout portallé est ouvert par son vrai déclencheur. |
| `est-102-inline-edit.ps1` | Fixture éditable, saisie de remplacement, Ctrl+A, Ctrl+Z et non-édition des valeurs calculées. La navigation rejoint PU puis total selon les colonnes actuelles. |
| `est-103-multiselect.ps1` | Sélection Shift sans remplacement par Ctrl, contrôles bulk présents, application de la catégorie et du rôle demandés, suppression exacte des lignes sélectionnées et conservation des autres. |
| `est-104-clipboard.ps1` | Prévisualisation et insertion requises, TSV contenant des tabulations, fermeture automatique du dialogue, exactement une ligne valide insérée et exclusion de la ligne invalide. Le test ne ferme plus lui-même le dialogue avant d'en vérifier la fermeture. |
| `est-105-autosave.ps1` | État final exact `Sauvegardé` puis titre édité exact après réouverture. Le rendu intermédiaire de sauvegarde reste une observation temporelle : `useAutoSave` n'en garantit aucune durée minimale. Une sauvegarde rapide sans ce rendu est couverte par un contre-exemple positif. |
| `est-106-undo-redo.ps1` | Tous les contrôles existants de quantité, ajout/suppression, position restaurée, majoration bulk, reorder et rechargement propagent leur erreur. La création de fixture par repli doit aussi établir son titre. |
| `prices-page.ps1` | Offre existante éditable, statistiques, recherche DOM, fraîcheur, accents, historique et actualisation. L'ouverture/fermeture CSV vérifie le panneau réel et `aria-expanded`, pas le mot « fichier » déjà présent dans l'en-tête fermé. |
| `ti-153-suggestions.ps1` | Unité et type exacts ; une ligne absente ou des valeurs incorrectes ne produisent plus un diagnostic suivi d'un PASS. |
| `est-164-catalogue-suggestions.ps1`, `est-030-supplier-comparison.ps1`, `ti-147-editor.ps1` | Fixture persistée et résultats métier existants requis. Absence de suggestion, d'alternatives ou de ligne après reload : échec, sans PASS « skipped ». Les erreurs métier déjà fatales et les récupérations de transport vérifiées restent couvertes. |
| `common.ps1` / `Add-Line` | Échec de titre ou de persistance après épuisement du repli : erreur propagée. Les chemins de repli vérifiés restent disponibles. |

Les seuls WARN restants dans ces anciens scripts concernent deux récupérations
de setup suivies de contrôles obligatoires (`est-105`, `est-106`) et les colonnes
fournisseur vides d'une fixture d'export qui n'affecte aucun fournisseur
(`ti-152-export.ps1`). Ils ne remplacent pas une assertion échouée par un succès.

## Preuves exécutables avant correction

Un test navigateur ne permet pas de vérifier si son propre script avale ses
échecs. L'exception isolée est donc consacrée à cette frontière de validation :
les tests chargent les vraies fonctions et le vrai bloc `try/finally` depuis
l'AST PowerShell, puis remplacent seulement les frontières de navigateur et de
polling par des réponses contrôlées. Ils ne vérifient pas le code par recherche
de chaînes et ne se contentent pas de simuler la sortie d'un faux exécutable.

Chaque panne injectée exige un code non nul, le diagnostic concerné, l'absence
du PASS final et un nettoyage unique. Les contrôles positifs restent nécessaires
pour distinguer un vrai correctif d'un script qui échouerait systématiquement.
Les tests de propagation ne qualifient pas les montants, la persistance réelle
ou le comportement du navigateur ; les données de leurs frontières sont isolées.

PowerShell **7.6.6 arm64** est exécuté depuis un dossier temporaire, sans
installation globale. Archive [officielle Microsoft](https://github.com/PowerShell/PowerShell/releases/tag/v7.6.6),
SHA-256 vérifié avant extraction :
`6df833d094ebac1c1a74340d7b3437f4aaf5e03ce640484a1c4359f3ce8b3db1`.
Le runtime est sélectionné par `LEGACY_PWSH_PATH`. Une valeur configurée mais
inexécutable fait échouer les tests ; en local, l'absence de runtime détectable
produit des skips visibles.

Les journaux et manifestes sont sous
`test-results/legacy-assertions-2026-10-19/` : révision, hashes des sources,
commandes exactes, versions effectives, résultats et limites.

| Groupe | Rouge avant correction | Vert ciblé |
| --- | --- | --- |
| Inline / undo | 21 échecs, 6 succès | 27/27 |
| Autosave / clipboard | 7 échecs, 3 succès ; trois contre-exemples de collage supplémentaires échouent avant la correction de fermeture/comptage | 13/13 |
| Prix / suggestions | 15 échecs, 1 succès ; correction de fixture de panneau documentée | 16/16 |
| Clavier / multisélection / Add-Line | Rouge initial, contre-exemples d'identité et corrections du contrat actuel documentés dans le manifeste du groupe ; la première preuve est explicitement remplacée après revue | 27/27 : 25 cas PowerShell et 2 contrôles DOM du JavaScript émis par le vrai script |
| Fixtures catalogue / comparaison / éditeur | 9 échecs, 14 succès | 23/23 |

La revue indépendante a corrigé deux attentes historiques avant qualification :
incréments numériques et boutons supposés toujours montés côté clavier ;
confusion entre catégorie métier et type de fourniture, puis ancien lecteur de
rôle `<select>` au lieu du combobox actuel. Une assertion plus stricte contre
un contrat obsolète ne constitue pas une correction valide.

## Vérification finale et limites

La chaîne `npm run verify:pr` passe avec **sortie 0**, Node **24.19.0** et
PowerShell **7.6.6** configuré : audits npm/signatures, architecture, OpenAPI,
typecheck, lint, **3 392 tests Node**, **822 tests jsdom**, puis **12/12**
contrôles de couverture critique aux seuils inchangés. Les **106 nouvelles
régressions** sont incluses, sans skip dû au runtime. Les trois skips Node
préexistants sont les deux cas RLS sans pile éphémère et la garde exigeant bash
≥ 4, indisponible dans le PATH de ce run Mac. Ils ne sont pas des succès.

Commande finale :

```sh
LEGACY_PWSH_PATH=/private/tmp/mergeone-legacy-pwsh-7.6.6-20261019/runtime/pwsh \
PATH=/Users/timax/.local/share/mise/installs/node/24.19.0/bin:$PATH \
npm run verify:pr
```

Journal : `test-results/legacy-assertions-2026-10-19/verify-pr-final.log`.
Le manifeste du dossier conserve le périmètre, les hashes et les résultats.
Certains passages ciblés utilisent Node 24.21.0 ; leur version effective reste
dans leur propre manifeste et ne remplace pas le contrôle final sur Node 24.19.0.
`git diff --check` passe. Les revues indépendantes initiales et les reprises
ciblées après correction n'ont plus de constat important ouvert.

Une première chaîne complète avait échoué à la collecte de trois suites : le
probe de version héritait de `HOME`, contrairement aux cas de test déjà isolés.
Un diagnostic déterministe a reproduit l'erreur .NET avec cet héritage et sa
disparition dans l'environnement minimal. Le probe utilise maintenant le même
environnement minimal que les cas ; une configuration de runtime invalide reste
fatale. Aucune valeur de `HOME` n'est assignée, modifiée ou stockée. Le journal
initial et `startup-environment-diagnosis.json` sont conservés ; l'échec n'a pas
été converti en skip. Aucun code produit n'a changé pour résoudre ce démarrage.

Le smoke anonyme du premier audit porte sur des entrées applicatives inchangées.
Il n'est pas relancé ni présenté comme une preuve des scripts métier modifiés.
Aucun ancien parcours avec un vrai navigateur, un compte connecté ou une base
partagée n'est déclaré qualifié par les fixtures PowerShell. Aucun commit,
push, déploiement ni migration distante n'est effectué.

## Préparation de publication : PowerShell requis en CI

Le job `Tests` de `.github/workflows/quality-gate.yml` vérifie maintenant
`command -v pwsh`, exécute le runtime pour afficher sa version effective, puis
exporte son chemin dans `LEGACY_PWSH_PATH` via `GITHUB_ENV`. Ce préflight bash
utilise `set -euo pipefail` : un runtime absent ou inexécutable fait échouer le
job. Les tests spécialistes ne peuvent donc plus laisser ce job vert en raison
du seul manque de PowerShell. Aucun runtime n'est installé par cette étape ;
elle utilise celui du runner, sans imposer une version identique au runtime
portable local. Les contrôles, seuils, dépendances et reprises restent inchangés.

La vérification locale ci-dessus précède cet ajout de workflow et reste une
preuve locale historique. La validation du préflight porte sur le YAML, le
diff et des processus isolés : YAML analysé, `bash -n` et `git diff --check`
réussis ; runtime portable **7.6.6** accepté avec sortie **0** et chemin exporté,
runtime absent refusé avec sortie **1**, runtime défectueux refusé avec sortie
**37**, sans export dans ces deux derniers cas. Elle ne constitue pas une
nouvelle exécution GitHub Actions ni une qualification des parcours navigateur
connectés.
