# EST-E17 — Metres & formules de calcul

> Milestone: M5 | Priorite: P0 | Statut: A faire

## Objectif

Ajouter les formules de calcul dans les quantites (saisie d'expressions mathematiques au lieu de simples valeurs numeriques) et un carnet de metres integre pour justifier et tracer les calculs de quantites. Ces deux fonctionnalites sont presentes dans TOUS les logiciels de chiffrage BTP concurrents et leur absence est un frein majeur a l'adoption professionnelle.

## Ce qui existe deja

- **Schema DB** : colonne `quantity` (numeric) sur `estimate_items` — valeur numerique simple.
- **Takeoff IA** : module Gemini pour l'extraction de quantites depuis les plans. Ne remplace pas la justification detaillee des metres exigee par les MOE.
- **Editeur** : `src/components/estimates/EstimateEditorTable.tsx` — champ quantite numerique editable.
- **Moteur de calcul** : `src/lib/estimate-calculations.ts` — utilise `quantity` comme multiplicateur direct.

---

## EST-321 — Formules dans les quantites

**Priorite:** P0 | **Effort:** L | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux saisir des formules mathematiques dans le champ quantite (ex: `12.5 * 3.2 - 2*(1.2*2.1)`), afin de documenter mes calculs et de les modifier facilement sans recalculer manuellement.

### Criteres d'acceptation

- [ ] Nouveau champ `quantity_formula` (text, nullable) sur `estimate_items` : stocke l'expression saisie
- [ ] Le champ `quantity` (numeric) reste la valeur calculee, mise a jour automatiquement a chaque modification de la formule
- [ ] Parseur d'expressions mathematiques : operations de base (+, -, *, /), parentheses, nombres decimaux
- [ ] Variables locales : possibilite de definir des variables dans la formule (ex: `L=12.5; l=3.2; L*l`)
- [ ] References croisees : une formule peut referencer la quantite d'une autre ligne par son numero (ex: `#01.2.1 * 1.1`)
- [ ] Affichage : le champ quantite montre la valeur calculee, au survol/clic on voit la formule source
- [ ] Erreurs de formule : affichage visuel (bordure rouge, tooltip) si la formule est invalide, la quantite reste a la derniere valeur valide
- [ ] Les formules sont preservees dans l'export DPGF et la vue impression (optionnellement)
- [ ] Retrocompatibilite : les lignes sans formule continuent de fonctionner avec `quantity` numerique simple
- [ ] Le copier-coller depuis Excel preserve les formules (si la cellule source contient une formule)

### Notes techniques

- Fichiers a creer : `src/lib/estimates/formula-parser.ts` (parseur + evaluateur d'expressions)
- Fichiers a modifier : `src/components/estimates/EstimateEditorRow.tsx` (champ quantite avec formule), `src/lib/estimate-calculations.ts` (evaluation formules avant calcul)
- Migration DB : ajouter `quantity_formula` (text, nullable) sur `estimate_items`
- Reutiliser : pattern d'edition inline existant dans l'editeur
- Dependances : aucune

---

## EST-322 — Carnet de metres integre

**Priorite:** P0 | **Effort:** L | **Milestone:** M5

### User Story

> En tant que chiffreur, je veux un carnet de metres structure (longueur x largeur x hauteur, deductions, par piece/zone/etage) qui alimente automatiquement les quantites du devis, afin de justifier le detail des metres aupres du maitre d'oeuvre (obligatoire marches publics).

### Criteres d'acceptation

- [ ] Nouvelle table `measurement_sheets` : feuille de metres rattachee a un `estimate_item`
- [ ] Chaque feuille contient des lignes de metres : localisation (piece/zone/etage), nombre, longueur, largeur, hauteur, commentaire, signe (+/-)
- [ ] Calcul automatique : chaque ligne = nombre x L x l x h (dimensions nulles ignorees), total = somme des lignes
- [ ] Le total du carnet de metres alimente automatiquement le `quantity` de la ligne du devis
- [ ] Deductions : lignes avec signe negatif pour les ouvertures, reserves, etc.
- [ ] Regroupement par localisation : sous-totaux par piece/zone/etage dans le carnet
- [ ] Vue carnet accessible depuis la ligne du devis (panneau lateral ou modal)
- [ ] Import du carnet depuis un fichier Excel/CSV (format standard : localisation, N, L, l, h)
- [ ] Le carnet est imprimable en annexe du devis (optionnel)
- [ ] Compatibilite avec le takeoff IA : les quantites extraites par Gemini peuvent alimenter un carnet de metres
- [ ] Le carnet coexiste avec les formules (EST-321) : une ligne peut avoir soit un carnet, soit une formule, soit une valeur directe

### Notes techniques

- Fichiers a creer : `src/lib/estimates/measurement-sheets.ts`, `src/components/estimates/MeasurementSheet.tsx`
- Migration DB : table `measurement_sheets` (estimate_item_id, location, count, length, width, height, sign, comment, position)
- Reutiliser : pattern panneau lateral des ouvrages, `computeEstimateLineValues()` pour le recalcul
- Dependances : EST-321 (coexistence formules/carnet)
