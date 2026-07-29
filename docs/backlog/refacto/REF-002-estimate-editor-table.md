# REF-002 - Decomposer EstimateEditorTable

- Fichier: `src/components/estimates/EstimateEditorTable.tsx`
- Priorite: P1
- Complexite: XL
- Statut: A faire

## Probleme

Le tableau d'edition concentre filtres, shortcuts, suggestions, conversions, menus, dialogs, virtualisation et rendu recursif dans une seule fonction principale.

## Pourquoi il est gros

- Beaucoup d'etat derive et de callbacks metier.
- Menus et dialogs inline a la fin du fichier.
- Chrome de table, header, footer et rendu des lignes tous colocalises.

## Refacto cible

- Extraire les menus et dialogs de section et fournisseur.
- Extraire le chrome de table, header et footer.
- Isoler la logique suggestion/conversion dans des hooks ou modules dedies.
- Conserver `EstimateEditorTable` comme point d'integration.

## Definition of done

- La fonction `EstimateEditorTable` perd au moins 40% de volume.
- Les modals et menus n'habitent plus le meme fichier.
- Les perfs de virtualisation et de rendu restent stables.
- Les flux edition, reorder et shortcuts restent inchanges.
