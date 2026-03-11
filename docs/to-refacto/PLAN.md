# Plan de refacto par priorite

Ce plan ordonne les tickets `REF-*` par risque, dependances et possibilites de travail en parallele.

## Regles de sequencing

- Faire les parents apres les enfants quand un composant importe directement les composants a refactorer.
- Faire les extracts "safe first" d'abord: modals, panneaux, hooks, helpers purs.
- Eviter de refactorer en parallele deux fichiers qui partagent la meme interface instable.
- Garder les tests du fichier refactore dans le meme lot que le refacto.

## Vague 0 - Preparation

Objectif: securiser les refactos avant d'ouvrir plusieurs chantiers.

- Verifier les tests existants sur la zone `estimates`, `affaires`, `takeoff`, `catalogue`, `imports`.
- Geler les interfaces publiques des composants parents avant extraction.
- Preferer une strategie `extract component` ou `extract hook` avant tout redesign.

Parallelisable:
- Oui, en lecture seulement.

## Vague 1 - P1 a lancer immediatement

### Stream A - Estimates editor

1. `REF-001` [EstimateEditorRow](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-001-estimate-editor-row.md)
2. `REF-002` [EstimateEditorTable](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-002-estimate-editor-table.md)

Pourquoi cet ordre:
- `EstimateEditorTable` importe directement `EstimateEditorRow`.
- Stabiliser `Row` d'abord reduit le risque de refaire deux fois les interfaces.

Parallelisable:
- `REF-001` et `REF-002`: non, pas en meme temps sauf si le scope de `REF-002` est strictement limite aux dialogs et au chrome de table sans toucher a l'API de `EstimateEditorRow`.

### Stream B - Catalogue

1. `REF-003` [PricesManager](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-003-prices-manager.md)

Parallelisable:
- Oui, completement independant des streams A, C, D et E.

### Stream C - Affaires register

1. `REF-004` [AffaireRegisterCard](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-004-affaire-register-card.md)

Parallelisable:
- Oui avec A, B, D et E.
- Oui avec `REF-014` si les props de `AffaireRegisterCard` restent stables.
- Eviter en parallele avec `REF-007` si `AffaireHub` doit changer l'integration de la card.

### Stream D - Approval

1. `REF-005` [EstimateApprovalActions](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-005-estimate-approval-actions.md)

Parallelisable:
- Oui avec A, B, C et E.
- Oui avec `REF-009` et `REF-011` car write set distinct si les types partages ne changent pas.

### Stream E - Imports

1. `REF-006` [ImportWizard](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-006-import-wizard.md)

Parallelisable:
- Oui avec tous les autres streams P1.

## Vague 2 - P2 structurel

### Stream F - Affaires hub

Ordre recommande:
1. `REF-014` [AffairePilotagePanel](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-014-affaire-pilotage-panel.md)
2. `REF-008` [UnifiedImportFlow](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-008-unified-import-flow.md)
3. `REF-007` [AffaireHub](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-007-affaire-hub.md)

Pourquoi cet ordre:
- `AffaireHub` importe `AffairePilotagePanel`, `AffaireRegisterCard` et `UnifiedImportFlow`.
- Refactorer les enfants d'abord evite de casser deux fois le hub.

Parallelisable:
- `REF-014` et `REF-008`: oui.
- `REF-007`: apres stabilisation de `REF-004`, `REF-008` et `REF-014`.

### Stream G - Estimates creation and draft

Ordre recommande:
1. `REF-009` [EstimateCreationWizard](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-009-estimate-creation-wizard.md)
2. `REF-011` [EstimateStructureDraftDialog](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-011-estimate-structure-draft-dialog.md)

Parallelisable:
- Oui entre eux si l'un travaille sur le wizard de creation et l'autre sur le dialog de draft.
- Oui avec `REF-005`.
- Oui avec `REF-002` seulement si `EstimateEditorPage` n'est pas modifie en meme temps.

### Stream H - Takeoff compare and apply

Ordre recommande:
1. `REF-012` [TakeoffDpgfCompareView](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-012-takeoff-dpgf-compare-view.md)
2. `REF-010` [TakeoffApplyWizard](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-010-takeoff-apply-wizard.md)

Parallelisable:
- Oui entre eux, car ils n'ecrivent pas les memes fichiers.
- Eviter de lancer `REF-015` en parallele tant que `REF-010` n'est pas stabilise.

### Stream I - Catalogue import specialise

1. `REF-013` [PriceBookCsvImport](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-013-price-book-csv-import.md)

Parallelisable:
- Oui avec tous les autres P2.
- Si `REF-003` est encore ouvert, garder une ownership stricte sur les fichiers `catalogue`.

## Vague 3 - P3 opportuniste

### Stream J - Takeoff orchestration

1. `REF-015` [TakeoffReviewPage](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-015-takeoff-review-page.md)

Pourquoi en dernier:
- `TakeoffReviewPage` importe `TakeoffApplyWizard`.
- Son type `ReviewItem` est consomme par plusieurs composants takeoff.
- C'est une page orchestratrice; mieux vaut la faire apres les sous-composants.

Parallelisable:
- Oui avec `REF-016`.
- Non recommande avec `REF-010`.

### Stream K - Dashboard metrics

1. `REF-016` [TakeoffMetricsDashboard](/home/tchau@france.groupe.intra/CascadeProjects/HEX_BC/docs/to-refacto/REF-016-takeoff-metrics-dashboard.md)

Parallelisable:
- Oui avec presque tout le reste.
- A traiter seulement en opportuniste.

## Plan d'execution concret

### Option 1 - 3 workstreams en parallele

- Workstream 1: `REF-001` puis `REF-002`
- Workstream 2: `REF-003` puis `REF-013`
- Workstream 3: `REF-004`, `REF-005`, `REF-006` en serie courte ou selon disponibilite

Puis:
- `REF-014` + `REF-008` en parallele
- `REF-007` apres stabilisation du stream affaires
- `REF-009` + `REF-011` en parallele
- `REF-012` + `REF-010` en parallele
- `REF-015` et `REF-016` en dernier

### Option 2 - 5 workstreams en parallele

- Team A: `REF-001` -> `REF-002`
- Team B: `REF-003` -> `REF-013`
- Team C: `REF-004` -> `REF-014` -> `REF-008` -> `REF-007`
- Team D: `REF-005` -> `REF-009` -> `REF-011`
- Team E: `REF-012` -> `REF-010` -> `REF-015`

`REF-006` peut etre pris par B, C ou D selon charge.
`REF-016` est un ticket de lissage a placer entre deux gros chantiers.

## Ce qu'il ne faut pas faire en parallele

- `REF-001` et `REF-002` sans ownership stricte des interfaces row/table.
- `REF-007` en meme temps que `REF-004`, `REF-008` ou `REF-014` si les props des enfants changent.
- `REF-015` en meme temps que `REF-010` tant que `TakeoffApplyWizard` bouge.
- Deux tickets `catalogue` sur le meme fichier sans separation stricte des write sets.

## Ordre final recommande

1. `REF-001`
2. `REF-003`
3. `REF-004`
4. `REF-005`
5. `REF-006`
6. `REF-002`
7. `REF-014`
8. `REF-008`
9. `REF-009`
10. `REF-011`
11. `REF-012`
12. `REF-010`
13. `REF-013`
14. `REF-007`
15. `REF-015`
16. `REF-016`
