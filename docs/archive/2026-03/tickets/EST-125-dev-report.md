# EST-125 — Rapport de modifications pour le dev

> Date: 2026-03-05
> Concerne: EST-125 (hierarchie multi-niveaux) + impacts sur EST-121, EST-122, EST-124
> Priorite: A traiter lors de l'implementation de EST-125

---

## Changement majeur : noeuds mixtes autorises

La spec a ete corrigee pour refleter la realite metier du chiffrage BTP (comme Batappli, DeviSOC, Attic+). **Une section peut desormais contenir a la fois des sous-sections ET des lignes directes** (noeud mixte).

Avant (incorrect) :
```
Section "Gros oeuvre"
  Section "Fondations"
    Ligne "Beton C25/30"      <- lignes uniquement au dernier niveau
```

Apres (correct, conforme aux DPGF) :
```
Section "Gros oeuvre"
  Ligne "Installation de chantier"   <- ligne directe sous un lot
  Section "Fondations"
    Ligne "Etudes de sol"            <- ligne directe sous un chapitre
    Section "Semelles filantes"
      Ligne "Beton C25/30"
```

---

## Impact 1 : Numerotation (`src/lib/estimates/numbering.ts`)

### Probleme actuel

Le code actuel (lignes 48-57) utilise un index global sur tous les enfants mais applique un **format different selon le type** :
- Lignes → zero-padded (`"01"`, `"02"`)
- Sections imbriquees → non-padded (`"1"`, `"2"`)

Dans un noeud mixte, ca donne une numerotation inconstante :
```
01.01  Installation chantier  (ligne)
01.2   Fondations             (section)   <- saut de format
01.03  Nettoyage              (ligne)
```

### Correction demandee

**Compteur unique + format uniforme** par profondeur :
- Racine (depth 0) : zero-padded 2 chiffres → `01`, `02`
- Niveaux suivants (depth 1+) : sans padding → `1`, `2`, `3`
- Le type (section/ligne) n'affecte PAS le format du numero

Resultat attendu :
```
01      Section "Gros oeuvre"
01.1    Ligne "Installation de chantier"
01.2    Section "Fondations"
01.2.1  Ligne "Etudes de sol"
01.2.2  Section "Semelles filantes"
01.2.2.1  Ligne "Beton C25/30"
01.2.2.2  Ligne "Acier HA"
01.2.3  Section "Longrines"
01.2.3.1  Ligne "Coffrage"
01.3    Section "Elevations"
02      Section "Plomberie"
```

### Code a modifier

Fichier : `src/lib/estimates/numbering.ts`, fonction `walkItem` (lignes 42-58)

Remplacer la logique du `childSegment` :
```typescript
// AVANT (format depend du type)
const childSegment =
  child.item_type === "line"
    ? String(ordinal).padStart(2, "0")
    : segments.length === 0
      ? String(ordinal).padStart(2, "0")
      : String(ordinal);

// APRES (format depend uniquement de la profondeur)
const childSegment =
  segments.length === 0
    ? String(ordinal).padStart(2, "0")   // racine : "01", "02"
    : String(ordinal);                    // niveaux suivants : "1", "2"
```

C'est un changement de **3 lignes**. Les tests existants doivent etre mis a jour pour refleter le nouveau format.

---

## Impact 2 : Sous-totaux (`src/lib/estimate-calculations.ts`)

### Verification necessaire

`computeSectionTotals()` doit agreger :
1. Les lignes **directes** de la section (enfants directs de type `line`)
2. Les sous-totaux des **sous-sections** (enfants directs de type `section`, recursivement)

Le code existant gere deja les descendants recursifs (confirme dans EST-121 notes). **Verifier** que les lignes directes d'un noeud mixte ne sont pas oubliees ni comptees en double.

### Cas de test a ajouter

```
Section A (sous-total attendu: 300)
  Ligne directe 1 : 100 EUR
  Section B (sous-total attendu: 200)
    Ligne B.1 : 150 EUR
    Ligne B.2 : 50 EUR
```

Le sous-total de A doit etre `100 + 200 = 300`, pas `200` (si les lignes directes sont ignorees) ni `100 + 150 + 50 + 200 = 500` (si double-comptage).

---

## Impact 3 : Drag-and-drop (`EstimateEditorTable.tsx`)

### Modification necessaire

Le DnD doit permettre de dropper une **ligne** dans n'importe quelle section (pas seulement les sections feuilles). L'UI doit montrer clairement la zone de drop et gerer l'insertion parmi des enfants mixtes (sous-sections + lignes).

### Verification

S'assurer que `move_estimate_item()` cote DB n'a pas de contrainte empechant une ligne d'etre enfant d'une section qui a deja des sous-sections.

---

## Impact 4 : Validation DB

### Verification necessaire

Verifier qu'il n'existe **aucun CHECK constraint** dans les migrations qui forcerait les lignes a n'exister qu'au dernier niveau. La seule contrainte de profondeur doit s'appliquer aux **sections** (ne pas depasser `max_section_depth`), pas aux lignes.

---

## Resume des fichiers a modifier

| Fichier | Action | Effort |
|---------|--------|--------|
| `src/lib/estimates/numbering.ts` | Modifier `childSegment` (3 lignes) | XS |
| `src/lib/estimates/numbering.test.ts` | Adapter les tests existants + ajouter cas noeuds mixtes | S |
| `src/lib/estimate-calculations.ts` | Verifier `computeSectionTotals()` gere les noeuds mixtes | XS (verif) |
| `src/lib/estimate-calculations.test.ts` | Ajouter test noeud mixte (section + lignes directes) | S |
| `src/components/estimates/EstimateEditorTable.tsx` | DnD : autoriser drop ligne dans toute section | M |
| `supabase/migrations/` | Verifier absence de contrainte bloquante | XS (verif) |
| `src/lib/estimates/server.ts` | CRUD : pas de blocage sur ajout ligne dans noeud mixte | XS (verif) |

---

## Tests de non-regression

1. Devis existants (2 niveaux) : la numerotation ne doit pas changer pour les structures sans noeuds mixtes au-dela du format (ex: `01.01` lignes sous section racine deviennent `01.1`)
2. Les sous-totaux des devis existants ne doivent pas changer
3. Le DnD existant continue de fonctionner

**Attention :** le changement de format de numerotation (lignes `01.01` → `01.1`) est un breaking change visuel. Si des exports DPGF referencent les anciens numeros, prevoir une periode de transition ou un flag de compatibilite.
