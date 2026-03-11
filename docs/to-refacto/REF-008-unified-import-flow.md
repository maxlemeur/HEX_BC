# REF-008 - Decouper UnifiedImportFlow

- Fichier: `src/components/affaires/UnifiedImportFlow.tsx`
- Priorite: P2
- Complexite: XL
- Statut: A faire

## Probleme

Le fichier contient un wizard complet avec `UploadStep`, `MappingStep`, `PreviewStep`, `ConfirmationStep` et le controleur final.

## Pourquoi il est gros

- Chaque etape porte son propre fetch, son propre etat et son propre rendu.
- Les frontieres existent deja, mais elles sont encore dans un seul fichier.

## Refacto cible

- Sortir chaque etape dans un fichier dedie.
- Extraire `fetchApi` et les helpers de preview takeoff.
- Garder `UnifiedImportFlow` comme orchestrateur de transitions.

## Definition of done

- Une etape par fichier.
- Le controleur principal ne porte plus le rendu detaille de chaque etape.
- Les transitions et annulations restent strictement identiques.
