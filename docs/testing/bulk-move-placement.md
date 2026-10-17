# Déplacement en lot : placement non enregistré

Suspicion relevée le 16/10/2026 en lisant `useEstimateEditorBulkController`
pendant la correction de [la référence de synchronisation](bulk-edit-sync-baseline.md).

## Cause lue dans le code (avant correction)

« Déplacer les lignes sélectionnées vers » (`bulkMoveLines`) calcule pour chaque
ligne un nouveau `parent_id` et une `position` en fin de destination, met à jour
la grille, puis écrit par `applyBulkLineState()`. Cette fonction envoie
`buildEstimateItemUpdatePayload(line)` (`src/lib/estimates/editor-items.ts`), qui
ne contient ni `parent_id` ni `position`. Le serveur les accepte pourtant
(`bulkUpdateEstimateItemsRequestSchema`, RPC `bulk_update_estimate_items`, qui
gère les collisions de position). Le déplacement n'existerait donc que dans la
page et serait perdu au rechargement. L'annulation et le rétablissement passent
par la même fonction. Le test isolé existant
(`useEstimateEditorBulkController.test.ts`) ne vérifie que l'état local et les
identifiants envoyés.

## Défaillances observables et scénarios

Fixture : brouillon ARMY à trois niveaux de sections (`createLineViaApi`), une
ligne déplacée L sous la section feuille S, une section sœur cible C contenant
déjà une ligne E (position 1).

| Défaillance observable | Scénario et oracle |
| --- | --- |
| M1. Le déplacement n'est pas enregistré | Sélectionner L, destination C, « Déplacer » → API : L sous C, position = position de E + 1, prix inchangé. Rechargement : même placement. Rouge attendu avant correction. |
| M2. L'annulation ne remet pas la ligne à sa place sur le serveur | « Annuler » → API : L sous S, position 1. |
| M3. Le rétablissement ne redéplace pas la ligne sur le serveur | « Rétablir » → API : L sous C, après E ; rechargement : même placement. |
| M4. Le déplacement modifie une autre valeur de la ligne | Prix d'achat, quantité et totaux de L identiques avant et après. |

Parcours : `e2e/army/critical/bulk-move.e2e.ts` (titre « bulk move … »). Le
calcul n'est pas concerné : `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` restent sans modification.

## Correction

`bulkMoveLines` passe à `applyBulkLineState()` une charge placée
(`buildPlacedLineUpdatePayload` : charge de la ligne, plus `parent_id` et
`position`) pour le déplacement, son annulation et son rétablissement. Les
autres actions en lot gardent la charge de ligne seule. La RPC
`bulk_update_estimate_items` applique déjà ces deux champs.

## Preuve rouge (17/10/2026)

`.e2e/army/ci/2026-10-17T09-18-37-849Z-critical` (manifeste SHA-256
`dc59ca51ec8368700feb070e9363fe49f339e77f4663c4891df22c5d0be08d65`), clone WSL
`~/miaouffrage-bulk-sync-20261016`, révision `de54931d` plus correctif de la
référence de synchronisation, sans ce correctif :
`npm run e2e:army:local -- --grep 'bulk edit sync suggestions|bulk move' --app-port 3127`
(avec `NODE_OPTIONS=--max-old-space-size=4096`). Après « Déplacer », le serveur
garde la ligne sous sa section d'origine, position 1, au lieu de la section cible
position 2 : **M1 rouge** (`bulk-move-placements.json`).

## Preuve verte (17/10/2026)

`.e2e/army/ci/2026-10-17T09-24-39-195Z-critical` (manifeste SHA-256
`c309995e388a48bd44a49a1e5b077e043a185a577d826be6530fc3240312de4f`, statut
`passed`, `--grep 'bulk edit sync|bulk move'`, build `zShSU5JoM1CVgJIZftsH2`).
Placements relus par l'API : déplacé → section cible, position 2 ; annulé →
section d'origine, position 1 ; rétabli → section cible, position 2 ; après
rechargement → section cible, position 2, et la grille affiche la ligne existante
puis la ligne déplacée. Quantité, prix d'achat et total HT inchangés (M4). Le
test isolé existant du lot passe 8/8 avant et après sans modification de ses
assertions. Contrôles et limites communs : voir
[la référence de synchronisation](bulk-edit-sync-baseline.md#preuve-verte-finale-17102026-tous-les-correctifs).
