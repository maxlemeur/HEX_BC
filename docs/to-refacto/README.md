# Backlog refacto composants volumineux

Ce dossier regroupe les tickets de refacto pour les composants `src/components/**` dont la taille est devenue un signal de risque de maintenance.

Principe:
- `> 1000` lignes n'est pas un bug en soi.
- Le refacto devient recommande quand le fichier melange orchestration, logique metier, appels reseau, etat local et gros rendus JSX.

Plan d'execution recommande: [PLAN.md](./PLAN.md)

## Tickets

| Ticket | Fichier | Lignes | Priorite | Complexite | Statut |
| --- | --- | ---: | --- | --- | --- |
| [REF-001](./REF-001-estimate-editor-row.md) | `src/components/estimates/components/EstimateEditorRow.tsx` | 2371 | P1 | XL | A faire |
| [REF-002](./REF-002-estimate-editor-table.md) | `src/components/estimates/EstimateEditorTable.tsx` | 2900 | P1 | XL | A faire |
| [REF-003](./REF-003-prices-manager.md) | `src/components/catalogue/PricesManager.tsx` | 1031 | P1 | L | A faire |
| [REF-004](./REF-004-affaire-register-card.md) | `src/components/affaires/AffaireRegisterCard.tsx` | 1176 | P1 | L | A faire |
| [REF-005](./REF-005-estimate-approval-actions.md) | `src/components/estimates/EstimateApprovalActions.tsx` | 1514 | P1 | L | A faire |
| [REF-006](./REF-006-import-wizard.md) | `src/components/imports/ImportWizard.tsx` | 1028 | P1 | L | A faire |
| [REF-007](./REF-007-affaire-hub.md) | `src/components/affaires/AffaireHub.tsx` | 1770 | P2 | XL | A faire |
| [REF-008](./REF-008-unified-import-flow.md) | `src/components/affaires/UnifiedImportFlow.tsx` | 1615 | P2 | XL | A faire |
| [REF-009](./REF-009-estimate-creation-wizard.md) | `src/components/estimates/EstimateCreationWizard.tsx` | 1379 | P2 | L | A faire |
| [REF-010](./REF-010-takeoff-apply-wizard.md) | `src/components/takeoff/TakeoffApplyWizard.tsx` | 1290 | P2 | L | A faire |
| [REF-011](./REF-011-estimate-structure-draft-dialog.md) | `src/components/estimates/EstimateStructureDraftDialog.tsx` | 1451 | P2 | XL | A faire |
| [REF-012](./REF-012-takeoff-dpgf-compare-view.md) | `src/components/takeoff/TakeoffDpgfCompareView.tsx` | 1906 | P2 | L | A faire |
| [REF-013](./REF-013-price-book-csv-import.md) | `src/components/catalogue/PriceBookCsvImport.tsx` | 1010 | P2 | L | A faire |
| [REF-014](./REF-014-affaire-pilotage-panel.md) | `src/components/affaires/AffairePilotagePanel.tsx` | 1358 | P2 | M | A faire |
| [REF-015](./REF-015-takeoff-review-page.md) | `src/components/takeoff/TakeoffReviewPage.tsx` | 1528 | P3 | M | A faire |
| [REF-016](./REF-016-takeoff-metrics-dashboard.md) | `src/components/takeoff/TakeoffMetricsDashboard.tsx` | 1082 | P3 | M | A faire |

## Lecture des priorites

- `P1`: composant monolithique ou a fort cout d'evolution. Refacto recommande des maintenant.
- `P2`: refacto utile mais moins urgent. A planifier quand la zone est rouverte.
- `P3`: taille acceptable a court terme. Refacto opportuniste uniquement.

## Lecture des complexites

- `M`: extraction relativement sure, principalement presentation ou logique pure.
- `L`: plusieurs extractions coordonnees, avec regression possible si interfaces mal stabilisees.
- `XL`: refacto structurel avec logique metier dense, fort couplage ou risques de performance.
