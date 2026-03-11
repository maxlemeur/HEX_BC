# REF-007 - Decouper AffaireHub

- Fichier: `src/components/affaires/AffaireHub.tsx`
- Priorite: P2
- Complexite: XL
- Statut: A faire

## Probleme

Le hub d'affaire melange orchestration de page, onboarding, logique cockpit, import flow et plusieurs sous-cartes locales assez autonomes.

## Pourquoi il est gros

- Plusieurs sous-composants internes deja visibles dans le fichier.
- Beaucoup d'effets et de logique client dans le composant racine.

## Refacto cible

- Sortir `ActionBar`, `AffaireProgressStrip`, `FinancialSummaryCard`, `VersionTimelineCard`, `DpgfSourceCard`.
- Extraire la logique cockpit dans un hook dedie.
- Isoler le shell d'import de l'orchestrateur principal.

## Definition of done

- Les cartes locales deviennent des composants fichiers.
- Le hub garde l'assemblage de page.
- Les flows onboarding, cockpit et import ne regressent pas.
